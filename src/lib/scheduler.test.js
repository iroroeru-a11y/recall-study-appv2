import { describe, it, expect } from "vitest";
import { scheduleReview, capIntervalForExam, getDueCards } from "./scheduler";
const base = { ease: 2.5, interval: 0, reps: 0, lapses: 0, dueDate: "2020-01-01T00:00:00.000Z" };
const now = new Date("2025-01-01T12:00:00.000Z");
describe("SM-2 scheduler", () => {
  it("resets a lapse and schedules relearning", () => {
    const result = scheduleReview(base, 0, now);
    expect(result.reps).toBe(0);
    expect(result.lapses).toBe(1);
    expect(result.ease).toBe(2.3);
    expect(new Date(result.dueDate).getTime()).toBe(now.getTime() + 600000);
  });
  it("graduates a new card after a good response", () => {
    const result = scheduleReview(base, 2, now);
    expect(result.reps).toBe(1);
    expect(result.interval).toBe(1);
    expect(result.ease).toBeGreaterThan(2.5);
  });
  it("uses a longer first interval for easy", () => {
    expect(scheduleReview(base, 3, now).interval).toBe(3);
  });
  it("never lets ease fall below 1.3", () => {
    const result = scheduleReview({ ...base, ease: 1.3 }, 0, now);
    expect(result.ease).toBe(1.3);
  });
  it("caps an interval at the exam date", () => {
    expect(capIntervalForExam(30, now, "2025-01-05")).toBe(3);
  });
  it("returns due cards oldest first", () => {
    const cards = [{ id: "b", dueDate: "2024-12-31" }, { id: "a", dueDate: "2024-01-01" }, { id: "c", dueDate: "2026-01-01" }];
    expect(getDueCards(cards, now).map(c => c.id)).toEqual(["a", "b"]);
  });
});
