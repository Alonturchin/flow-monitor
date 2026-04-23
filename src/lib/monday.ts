// Monday.com GraphQL API client.
// Server-side only.

const MONDAY_API_URL = 'https://api.monday.com/v2'

async function mondayQuery<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const apiKey = process.env.MONDAY_API_KEY
  if (!apiKey) throw new Error('MONDAY_API_KEY is not set')

  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  })

  if (!res.ok) throw new Error(`Monday API error ${res.status}: ${await res.text()}`)

  const json = (await res.json()) as { data: T; errors?: { message: string }[] }
  if (json.errors?.length) throw new Error(`Monday GraphQL: ${json.errors.map((e) => e.message).join(', ')}`)
  return json.data
}

// ─── Create a task item ───────────────────────────────────────────────────────

export interface CreateTaskParams {
  boardId: string
  groupId?: string
  name: string
  description: string
  severity: 'critical' | 'warning' | 'info'
}

interface CreateItemResponse {
  create_item: { id: string; name: string }
}

export async function createTask(params: CreateTaskParams): Promise<{ id: string; name: string }> {
  const { boardId, groupId, name, description, severity } = params

  // Step 1: Create the item with just the name — works on ANY board structure.
  const mutation = groupId
    ? `mutation($boardId: ID!, $groupId: String!, $name: String!) {
         create_item(board_id: $boardId, group_id: $groupId, item_name: $name) {
           id name
         }
       }`
    : `mutation($boardId: ID!, $name: String!) {
         create_item(board_id: $boardId, item_name: $name) {
           id name
         }
       }`

  const variables: Record<string, unknown> = { boardId, name }
  if (groupId) variables.groupId = groupId

  const data = await mondayQuery<CreateItemResponse>(mutation, variables)
  const item = data.create_item

  // Step 2: Add the description as an "update" (comment) on the item.
  // Updates always work regardless of the board's column structure.
  const fullBody = description
    + (severity ? `\n\n_Severity: ${severity}_` : '')

  try {
    await mondayQuery(
      `mutation($itemId: ID!, $body: String!) {
         create_update(item_id: $itemId, body: $body) { id }
       }`,
      { itemId: item.id, body: fullBody }
    )
  } catch (err) {
    // If update creation fails, the item is still created — don't block.
    console.warn('[monday.createTask] create_update failed:', err)
  }

  return item
}

// ─── Board / group discovery ──────────────────────────────────────────────────

export async function getBoards(): Promise<{ id: string; name: string; workspace_name?: string }[]> {
  // Paginate through all boards (Monday API max limit is 500 per page)
  const results: { id: string; name: string; workspace_name?: string }[] = []
  let page = 1
  const PAGE_SIZE = 200

  while (true) {
    const data = await mondayQuery<{
      boards: { id: string; name: string; state: string; workspace: { name: string } | null }[]
    }>(
      `query($page: Int!, $limit: Int!) {
        boards(page: $page, limit: $limit, order_by: used_at) {
          id name state workspace { name }
        }
      }`,
      { page, limit: PAGE_SIZE }
    )

    const boards = data.boards ?? []
    for (const b of boards) {
      if (b.state === 'active' || b.state === null) {
        results.push({
          id: b.id,
          name: b.name,
          workspace_name: b.workspace?.name,
        })
      }
    }

    if (boards.length < PAGE_SIZE) break
    page++
    if (page > 20) break  // safety cap — 4000 boards
  }

  return results
}

export async function getBoardGroups(boardId: string): Promise<{ id: string; title: string }[]> {
  const data = await mondayQuery<{ boards: { groups: { id: string; title: string }[] }[] }>(
    `query($id: ID!) { boards(ids: [$id]) { groups { id title } } }`,
    { id: boardId }
  )
  return data.boards[0]?.groups ?? []
}

export { mondayQuery }
