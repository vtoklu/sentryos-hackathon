import { query } from '@anthropic-ai/claude-agent-sdk'
import * as Sentry from '@sentry/nextjs'

const SYSTEM_PROMPT = `You are a helpful personal assistant designed to help with general research, questions, and tasks.

Your role is to:
- Answer questions on any topic accurately and thoroughly
- Help with research by searching the web for current information
- Assist with writing, editing, and brainstorming
- Provide explanations and summaries of complex topics
- Help solve problems and think through decisions

Guidelines:
- Be friendly, clear, and conversational
- Use web search when you need current information, facts you're unsure about, or real-time data
- Keep responses concise but complete - expand when the topic warrants depth
- Use markdown formatting when it helps readability (bullet points, code blocks, etc.)
- Be honest when you don't know something and offer to search for answers`

interface MessageInput {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(request: Request) {
  const requestStartTime = performance.now()

  // Track API call counter
  Sentry.metrics.count('api.chat.request', 1, {
    attributes: { endpoint: '/api/chat' }
  })

  Sentry.logger.info('Chat API request received')

  try {
    const { messages } = await request.json() as { messages: MessageInput[] }

    if (!messages || !Array.isArray(messages)) {
      Sentry.logger.warn('Invalid request: messages array missing or invalid')
      Sentry.metrics.count('api.chat.validation_error', 1, {
        attributes: { error_type: 'missing_messages' }
      })

      return new Response(
        JSON.stringify({ error: 'Messages array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Get the last user message
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()
    if (!lastUserMessage) {
      Sentry.logger.warn('Invalid request: no user message found')
      Sentry.metrics.count('api.chat.validation_error', 1, {
        attributes: { error_type: 'no_user_message' }
      })

      return new Response(
        JSON.stringify({ error: 'No user message found' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Track message count metric
    Sentry.metrics.gauge('api.chat.message_count', messages.length, {
      unit: 'none',
      attributes: { endpoint: '/api/chat' }
    })

    Sentry.logger.info('Processing chat request', {
      messageCount: messages.length,
      lastMessageLength: lastUserMessage.content.length
    })

    // Build conversation context
    const conversationContext = messages
      .slice(0, -1) // Exclude the last message since we pass it as the prompt
      .map((m: MessageInput) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n')

    const fullPrompt = conversationContext
      ? `${SYSTEM_PROMPT}\n\nPrevious conversation:\n${conversationContext}\n\nUser: ${lastUserMessage.content}`
      : `${SYSTEM_PROMPT}\n\nUser: ${lastUserMessage.content}`

    // Create a streaming response
    Sentry.logger.info('Starting Claude agent query stream')
    const streamStartTime = performance.now()
    let toolCallCount = 0

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Use the claude-agent-sdk query function with all default tools enabled
          for await (const message of query({
            prompt: fullPrompt,
            options: {
              maxTurns: 10,
              // Use the preset to enable all Claude Code tools including WebSearch
              tools: { type: 'preset', preset: 'claude_code' },
              // Bypass all permission checks for automated tool execution
              permissionMode: 'bypassPermissions',
              allowDangerouslySkipPermissions: true,
              // Enable partial messages for real-time text streaming
              includePartialMessages: true,
              // Set working directory to the app's directory for sandboxing
              cwd: process.cwd(),
            }
          })) {
            // Handle streaming text deltas (partial messages)
            if (message.type === 'stream_event' && 'event' in message) {
              const event = message.event
              // Handle content block delta events for text streaming
              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ type: 'text_delta', text: event.delta.text })}\n\n`
                ))
              }
            }

            // Send tool start events from assistant messages
            if (message.type === 'assistant' && 'message' in message) {
              const content = message.message?.content
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'tool_use') {
                    toolCallCount++
                    Sentry.logger.info('Tool call initiated', { toolName: block.name })
                    Sentry.metrics.count('api.chat.tool_call', 1, {
                      attributes: { tool_name: block.name }
                    })

                    controller.enqueue(encoder.encode(
                      `data: ${JSON.stringify({ type: 'tool_start', tool: block.name })}\n\n`
                    ))
                  }
                }
              }
            }

            // Send tool progress updates
            if (message.type === 'tool_progress') {
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'tool_progress', tool: message.tool_name, elapsed: message.elapsed_time_seconds })}\n\n`
              ))
            }

            // Signal completion
            if (message.type === 'result' && message.subtype === 'success') {
              const streamDuration = performance.now() - streamStartTime
              Sentry.logger.info('Chat stream completed successfully', {
                durationMs: streamDuration,
                toolCallCount
              })

              Sentry.metrics.distribution('api.chat.stream_duration', streamDuration, {
                unit: 'millisecond',
                attributes: { status: 'success' }
              })

              Sentry.metrics.count('api.chat.success', 1)

              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'done' })}\n\n`
              ))
            }

            // Handle errors
            if (message.type === 'result' && message.subtype !== 'success') {
              const streamDuration = performance.now() - streamStartTime
              Sentry.logger.error('Chat stream failed', {
                subtype: message.subtype,
                durationMs: streamDuration
              })

              Sentry.metrics.count('api.chat.error', 1, {
                attributes: { error_type: 'query_failed' }
              })

              Sentry.metrics.distribution('api.chat.stream_duration', streamDuration, {
                unit: 'millisecond',
                attributes: { status: 'error' }
              })

              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'error', message: 'Query did not complete successfully' })}\n\n`
              ))
            }
          }

          // Track final request duration
          const requestDuration = performance.now() - requestStartTime
          Sentry.metrics.distribution('api.chat.request_duration', requestDuration, {
            unit: 'millisecond',
            attributes: { endpoint: '/api/chat' }
          })

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (error) {
          Sentry.logger.error('Stream error occurred', {
            error: error instanceof Error ? error.message : 'Unknown error'
          })

          Sentry.metrics.count('api.chat.stream_error', 1)

          Sentry.captureException(error, {
            contexts: {
              chat: {
                messageCount: messages.length,
                toolCallCount
              }
            }
          })

          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'error', message: 'Stream error occurred' })}\n\n`
          ))
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    const requestDuration = performance.now() - requestStartTime

    Sentry.logger.error('Chat API error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      durationMs: requestDuration
    })

    Sentry.metrics.count('api.chat.error', 1, {
      attributes: { error_type: 'unhandled' }
    })

    Sentry.metrics.distribution('api.chat.request_duration', requestDuration, {
      unit: 'millisecond',
      attributes: { endpoint: '/api/chat', status: 'error' }
    })

    Sentry.captureException(error, {
      level: 'error',
      tags: {
        endpoint: '/api/chat'
      }
    })

    return new Response(
      JSON.stringify({ error: 'Failed to process chat request. Check server logs for details.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
