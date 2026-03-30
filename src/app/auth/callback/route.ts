'use server'

import { createSupabaseServerClient } from '@/lib/utils/supabase/server'
import { logger } from '@/lib/server_utilities'
import { NextResponse } from 'next/server'
import { sanitizeRedirectPath } from '@/lib/utils/sanitizeRedirectPath'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = sanitizeRedirectPath(searchParams.get('next') ?? '/', origin)

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    } else {
      logger.error('Error exchanging code for session', { error: error.message })
    }
  }

  // return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/error`)
} 