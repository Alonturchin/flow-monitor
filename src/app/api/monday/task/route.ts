import { NextResponse } from 'next/server'
import { createTask } from '@/lib/monday'
import { saveMondayTaskId } from '@/lib/alert-engine'
import { getFlowAlerts } from '@/lib/alert-engine'
import { getFlowDetail } from '@/lib/queries'
import { queryOne } from '@/lib/db'

export async function POST(req: Request) {
  if (!process.env.MONDAY_API_KEY) {
    return NextResponse.json({ error: 'MONDAY_API_KEY is not configured' }, { status: 400 })
  }

  // Prefer DB-configured board (from Settings UI), fall back to env var
  const settings = await queryOne<{ value: { board_id?: string; group_id?: string } }>(
    `SELECT value FROM app_settings WHERE key = 'monday'`
  )
  const boardId = settings?.value?.board_id ?? process.env.MONDAY_BOARD_ID
  const groupId = settings?.value?.group_id ?? process.env.MONDAY_GROUP_ID

  if (!boardId) {
    return NextResponse.json({
      error: 'No Monday board configured. Go to Settings → Monday integration to choose one.'
    }, { status: 400 })
  }

  try {
    const body = await req.json() as {
      flow_id: string
      alert_id?: number
      ab_test_id?: number
      description?: string
      name?: string
      task_type?: 'alert' | 'ab_test' | 'custom'
    }
    const { flow_id, alert_id, ab_test_id, description, name, task_type } = body

    const [detail, alerts] = await Promise.all([
      getFlowDetail(flow_id),
      getFlowAlerts(flow_id),
    ])

    if (!detail) return NextResponse.json({ error: 'Flow not found' }, { status: 404 })

    const topAlert = alerts[0]
    const severity = topAlert?.severity ?? 'info'

    // Build a default name based on task type if one wasn't provided
    let taskName = name
    if (!taskName) {
      if (task_type === 'ab_test') {
        taskName = `A/B Test: ${detail.flow.name}`
      } else if (task_type === 'alert' || topAlert) {
        taskName = `Flow Alert: ${detail.flow.name}`
      } else {
        taskName = `Flow: ${detail.flow.name}`
      }
    }

    const taskDescription = description
      ?? (topAlert
        ? `Flow: ${detail.flow.name}\nMetric: ${topAlert.metric} = ${(topAlert.value * 100).toFixed(2)}% (threshold ${(topAlert.threshold * 100).toFixed(2)}%)\n${topAlert.ai_suggestion ?? ''}`
        : `Review required for flow: ${detail.flow.name}`)

    const task = await createTask({
      boardId,
      groupId,
      name: taskName,
      description: taskDescription,
      severity,
    })

    // Persist Monday task ID on the alert if provided
    if (alert_id) {
      await saveMondayTaskId(alert_id, task.id)
    }

    // Persist Monday task ID on the A/B test if provided
    if (ab_test_id) {
      const { query } = await import('@/lib/db')
      await query(
        `UPDATE ab_tests SET monday_task_id = $1 WHERE id = $2`,
        [task.id, ab_test_id]
      )
    }

    return NextResponse.json({ ok: true, task })
  } catch (err) {
    console.error('[api/monday/task]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
