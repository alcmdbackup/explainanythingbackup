'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function ErrorContent() {
  const searchParams = useSearchParams()
  const message = searchParams.get('message')

  return (
    <div>
      <p>Sorry, something went wrong</p>
      {message && <p>Error: {message}</p>}
    </div>
  )
}

export default function ErrorPage() {
  return (
    <Suspense fallback={<div><p>Sorry, something went wrong</p></div>}>
      <ErrorContent />
    </Suspense>
  )
}