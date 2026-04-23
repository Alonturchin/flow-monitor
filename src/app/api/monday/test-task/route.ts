import { NextResponse } from 'next/server'
import { createTask } from '@/lib/monday'
import { queryOne } from '@/lib/db'

/** POST /api/monday/test-task — creates a test item on the configured board. */
export async function POST() {
  if (!process.env.MONDAY_API_KEY) {
    return NextResponse.json({ error: 'MONDAY_API_KEY is not configured' }, { status: 400 })
  }

  const settings = await queryOne<{ value: { board_id?: string; group_id?: string } }>(
    `SELECT value FROM app_settings WHERE key = 'monday'`
  )
  const boardId = settings?.value?.board_id ?? process.env.MONDAY_BOARD_ID
  const groupId = settings?.value?.group_id ?? process.env.MONDAY_GROUP_ID

  if (!boardId) {
    return NextResponse.json({ error: 'No board configured. Save a board first.' }, { status: 400 })
  }

  try {
    const task = await createTask({
      boardId,
      groupId,
      name: `Flow Monitor — test task (${new Date().toLocaleString()})`,
      description: 'This is a test task created from Flow Monitor to verify the Monday.com integration.',
      severity: 'info',
    })
    return NextResponse.json({ ok: true, task })
  } catch (err) {
    console.error('[api/monday/test-task]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
