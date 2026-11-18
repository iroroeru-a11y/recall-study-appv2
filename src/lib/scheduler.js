/**
 * SM-2 scheduler. Ratings: Again=0, Hard=1, Good=2, Easy=3.
 * Intervals are integer days; failed recall returns to a 10-minute relearning
 * step (represented as dueAt) and a 1-day interval for the next calendar queue.
 * This module intentionally has no UI or persistence dependency.
 */
export const RATING = Object.freeze({ AGAIN: 0, HARD: 1, GOOD: 2, EASY: 3 });
export const DAY = 24 * 60 * 60 * 1000;

export function scheduleReview(card, rating, now = new Date()) {
  if (![0, 1, 2, 3].includes(rating)) throw new Error("Rating must be between 0 and 3.");
  const next = { ...card };
  const oldInterval = Number(card.interval || 0);
  const oldEase = Number(card.ease || 2.5);
  const oldReps = Number(card.reps || 0);
  if (rating === RATING.AGAIN) {
    next.reps = 0;
    next.interval = 1;
    next.lapses = (card.lapses || 0) + 1;
    next.ease = Math.max(1.3, oldEase - 0.2);
    next.dueDate = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
    next.learning = true;
  } else {
    const quality = rating === RATING.HARD ? 3 : rating === RATING.GOOD ? 4 : 5;
    const delta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
    next.ease = Math.max(1.3, oldEase + delta);
    if (oldReps === 0) next.interval = rating === RATING.HARD ? 1 : rating === RATING.EASY ? 4 : 1;
    else if (oldReps === 1) next.interval = rating === RATING.HARD ? 2 : rating === RATING.EASY ? 6 : 6;
    else {
      const multiplier = rating === RATING.HARD ? Math.max(1.2, next.ease * 0.8) : rating === RATING.EASY ? next.ease * 1.3 : next.ease;
      next.interval = Math.max(oldInterval + 1, Math.round(oldInterval * multiplier));
    }
    next.reps = oldReps + 1;
    next.learning = next.interval < 21;
    next.dueDate = new Date(now.getTime() + next.interval * DAY).toISOString();
  }
  return { ...next, lastReviewedAt: now.toISOString() };
}

export function capIntervalForExam(interval, now, examDate) {
  if (!examDate) return interval;
  const exam = new Date(`${examDate}T00:00:00`);
  const daysLeft = Math.max(0, Math.floor((exam.getTime() - now.getTime()) / DAY));
  return Math.min(interval, daysLeft);
}

export function getDueCards(cards, now = new Date()) {
  return cards.filter(c => !c.suspended && new Date(c.dueDate || 0) <= now)
    .sort((a, b) => new Date(a.dueDate || 0) - new Date(b.dueDate || 0));
}
