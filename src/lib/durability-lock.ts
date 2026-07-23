let tail: Promise<void> = Promise.resolve()

/** Serialize project-wide flush, backup, open, switch, and quit barriers. */
export async function withDurabilityLock<T>(action: () => Promise<T>): Promise<T> {
  const previous = tail.catch(() => undefined)
  let release!: () => void
  tail = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await action()
  } finally {
    release()
  }
}
