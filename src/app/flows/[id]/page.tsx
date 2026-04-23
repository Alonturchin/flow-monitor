interface FlowDetailPageProps {
  params: { id: string }
}

export default function FlowDetailPage({ params }: FlowDetailPageProps) {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold text-gray-900">Flow Detail</h1>
      <p className="mt-2 text-gray-500">Flow ID: {params.id} — Phase 3</p>
    </main>
  )
}
