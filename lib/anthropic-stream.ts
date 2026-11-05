// Turns an Anthropic MessageStream into a plain-text streaming Response, the
// same delta-forwarding the other /api/chat branches do inline. Used by
// companion-v2 only; the Cube 1.0 branches are left as they are.
//
// Failure handling, so the client can tell a failed turn from a finished one:
// - Before the first event (overloaded, rate-limited, bad key...): the error
//   is thrown from startTextStream itself, and the caller answers with JSON.
// - Mid-stream: the ReadableStream is errored, so the client's reader throws
//   instead of seeing a normal end of stream.

import Anthropic from '@anthropic-ai/sdk';
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream';

interface Options {
  /** Called once the whole reply has streamed successfully. */
  onDone?: (final: Anthropic.Message, text: string) => void;
  label?: string;
}

// Dev-only failure injection for testing the client's retry path:
// COMPANION_V2_FAIL_AFTER_CHARS=200 errors the stream after ~200 characters.
function failAfterChars(): number | null {
  if (process.env.NODE_ENV === 'production') return null;
  const n = Number(process.env.COMPANION_V2_FAIL_AFTER_CHARS);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function startTextStream(stream: MessageStream, opts: Options = {}): Promise<Response> {
  const iterator = stream[Symbol.asyncIterator]();
  // Wait for the first event so connection-level errors surface here.
  const first = await iterator.next();

  const encoder = new TextEncoder();
  const failAt = failAfterChars();
  let text = '';

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: Anthropic.MessageStreamEvent) => {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          text += event.delta.text;
          controller.enqueue(encoder.encode(event.delta.text));
          if (failAt != null && text.length >= failAt) throw new Error('Injected failure (COMPANION_V2_FAIL_AFTER_CHARS)');
        }
      };
      try {
        if (!first.done) emit(first.value);
        for (let r = await iterator.next(); !r.done; r = await iterator.next()) emit(r.value);
        const final = await stream.finalMessage();
        if (final.stop_reason === 'max_tokens') {
          console.warn(`[${opts.label ?? 'stream'}] reply hit max_tokens; the end may be cut off`);
        }
        if (process.env.NODE_ENV !== 'production') {
          const u = final.usage;
          console.log(
            `[${opts.label ?? 'stream'}] stop=${final.stop_reason} in=${u.input_tokens} ` +
              `cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`
          );
        }
        opts.onDone?.(final, text);
        controller.close();
      } catch (err) {
        // The client went away (cancel() aborted the stream): not a failure.
        if (err instanceof Anthropic.APIUserAbortError) return;
        console.error(`[${opts.label ?? 'stream'}] failed mid-stream:`, err);
        stream.abort();
        controller.error(err);
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
