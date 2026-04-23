import { NextResponse } from 'next/server'
import { getBoards, getBoardGroups } from '@/lib/monday'

/**
 * GET /api/monday/boards — list all boards for the configured API key.
 * GET /api/monday/boards?board_id=X — list groups inside a specific board.
 */
export async function GET(req: Request) {
  if (!process.env.MONDAY_API_KEY) {
    return NextResponse.json({ error: 'MONDAY_API_KEY is not configured' }, { status: 400 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const boardId = searchParams.get('board_id')

    if (boardId) {
      const groups = await getBoardGroups(boardId)
      return NextResponse.json({ groups })
    }

    const boards = await getBoards()
    return NextResponse.json({ boards })
  } catch (err) {
    console.error('[api/monday/boards]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
