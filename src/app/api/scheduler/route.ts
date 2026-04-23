import { NextResponse } from 'next/server'
import { getSchedulerStatus } from '@/lib/scheduler'

export async function GET() {
  return NextResponse.json(getSchedulerStatus())
}
