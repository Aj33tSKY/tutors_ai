// One speed factor keeps waveform measurements and word timings in sync.
export const SPEECH_SPEED = 1.25;
export const CAPTION_DELAY = 0.25;
export const TUTOR_START = 0.3;
export const TURN_GAP = 1.5;
export const REVIEW_HOLD = 3.6;

export function shuffledScenarios(count: number, previous: number) {
  const queue = Array.from({ length: count }, (_, index) => index);
  for (let index = queue.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [queue[index], queue[other]] = [queue[other], queue[index]];
  }
  // The queue is consumed with pop(); avoid repeating the previous exchange.
  if (queue.length > 1 && queue.at(-1) === previous) {
    [queue[0], queue[queue.length - 1]] = [queue[queue.length - 1], queue[0]];
  }
  return queue;
}
