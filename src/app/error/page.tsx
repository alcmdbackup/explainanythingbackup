'use client'

import { useSearchParams } from 'next/navigation'

export default function ErrorPage() {
  const searchParams = useSearchParams()
  const message = searchParams.get('message')

  return (
    <div>
      <p>Sorry, something went wrong</p>
      {message && <p>Error: {message}</p>}
    </div>
  )
}