/**
 * Fetches a Google Drive thumbnailLink as base64.
 *
 * Drive thumbnail URLs are authenticated — they require the user's OAuth token.
 * Passing them directly as source.type='url' to Claude fails with 400 because
 * Claude can't access authenticated URLs.
 *
 * This helper fetches the thumbnail ourselves (it's a small JPEG, a few KB)
 * and returns it as base64 ready for source.type='base64'.
 */

export interface ThumbnailResult {
  data: string        // base64-encoded image
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
}

export async function fetchThumbnailAsBase64(
  thumbnailLink: string,
  accessToken?: string
): Promise<ThumbnailResult | null> {
  try {
    const headers: Record<string, string> = {}
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`
    }

    const res = await fetch(thumbnailLink, { headers })
    if (!res.ok) return null

    const contentType = res.headers.get('content-type') ?? ''

    // Reject anything that isn't an actual image — Drive sometimes returns
    // HTML redirects with a 200 status when auth fails or the thumbnail
    // isn't ready yet. Sending that base64 to Claude causes a 400.
    if (!contentType.startsWith('image/')) return null

    const mediaType = contentType.startsWith('image/png')  ? 'image/png'
                    : contentType.startsWith('image/webp') ? 'image/webp'
                    : contentType.startsWith('image/gif')  ? 'image/gif'
                    : 'image/jpeg'

    const buffer = await res.arrayBuffer()
    if (buffer.byteLength < 100) return null  // suspiciously small — probably not a real image

    const data = Buffer.from(buffer).toString('base64')
    return { data, mediaType }
  } catch {
    return null
  }
}
