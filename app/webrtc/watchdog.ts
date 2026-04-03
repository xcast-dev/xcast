export interface FrameWatchdogOptions {
  thresholdMs?: number
  checkIntervalMs?: number
  onFrozen: (lastFrameAge: number) => void
}

export class FrameWatchdog {
  private readonly thresholdMs: number
  private readonly checkIntervalMs: number
  private readonly onFrozen: (lastFrameAge: number) => void
  private timerId = 0
  private active = false
  private lastFrameTime = 0
  private frozenTriggered = false

  constructor(options: FrameWatchdogOptions) {
    this.thresholdMs = options.thresholdMs ?? 3000
    this.checkIntervalMs = options.checkIntervalMs ?? 1000
    this.onFrozen = options.onFrozen
  }

  recordFrame(): void {
    this.lastFrameTime = performance.now()
    this.frozenTriggered = false
  }

  start(): void {
    if (this.active) return
    this.active = true
    this.lastFrameTime = performance.now()
    this.frozenTriggered = false
    this.timerId = window.setInterval(() => {
      if (!this.active || this.frozenTriggered) return
      const age = performance.now() - this.lastFrameTime
      if (age >= this.thresholdMs) {
        this.frozenTriggered = true
        this.onFrozen(age)
      }
    }, this.checkIntervalMs)
  }

  stop(): void {
    this.active = false
    this.frozenTriggered = false
    if (this.timerId) {
      window.clearInterval(this.timerId)
      this.timerId = 0
    }
  }
}
