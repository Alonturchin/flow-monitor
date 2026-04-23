import { NextResponse } from 'next/server'
import { getFlowMessageNames } from '@/lib/klaviyo'
import { query } from '@/lib/db'

interface Params { params: { id: string } }

export async function GET(_req: Request, { params }: Params) {
  try {
    // Fetch message names from Klaviyo
    const names = await getFlowMessageNames(params.id)

    // Also update message_snapshots with any newly found names
    for (const [msgId, name] of names) {
      await query(
        `UPDATE message_snapshots SET message_name = $1 WHERE message_id = $2 AND message_name IS NULL`,
        [name, msgId]
      )
    }

    return NextResponse.json({ names: Object.fromEntries(names) })
  } catch (err) {
    console.error(`[api/flows/${params.id}/messages]`, err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
