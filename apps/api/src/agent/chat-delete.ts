/**
 * Wipe a chat's Durable Object. `destroy()` finishes by aborting the object, and that
 * abort reaches the caller as an error, so "destroyed" here means it worked. Anything
 * else is a real failure and the transcript may still be there.
 */
export async function wipeChat(stub: { cleanup: () => Promise<void> }): Promise<void> {
  try {
    await stub.cleanup();
  } catch (err) {
    if (!(err instanceof Error && err.message.includes("destroyed"))) throw err;
  }
}
