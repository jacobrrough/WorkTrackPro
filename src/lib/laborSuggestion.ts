/**
 * Labor hours suggestion from similar jobs.
 * Used by Create Job and Job Detail edit forms to suggest expected time.
 */

import { Job } from '@/core/types';
import { getWorkedShiftMs } from './lunchUtils';

/**
 * Find similar jobs by part number (base) or name/description word match.
 * @param searchTerm Product name or part number to search for
 * @param jobs All jobs to search
 * @returns Array of similar jobs
 */
export function findSimilarJobs(searchTerm: string, jobs: Job[]): Job[] {
  if (!searchTerm.trim()) return [];

  const term = searchTerm.toLowerCase().trim();
  const words = term.split(/\s+/);

  return jobs
    .filter((job) => {
      const jobName = (job.name || '').toLowerCase();
      const jobDesc = (job.description || '').toLowerCase();
      const jobCode = String(job.jobCode || '').toLowerCase();
      const searchText = `${jobName} ${jobDesc} ${jobCode}`;

      // Check if any word matches
      return words.some((word) => searchText.includes(word));
    })
    .slice(0, 10); // Limit to 10 most similar
}

/**
 * Calculate labor hours for a job from recorded shifts.
 * @param jobId Job ID
 * @param shifts All shifts (will be filtered by jobId)
 * @returns Total hours from completed shifts
 */
export function calculateJobHoursFromShifts(
  jobId: string,
  shifts: Array<{
    job: string;
    clockInTime: string;
    clockOutTime?: string;
    lunchStartTime?: string;
    lunchEndTime?: string;
    lunchMinutesUsed?: number;
  }>
): number {
  const jobShifts = shifts.filter((s) => s.job === jobId && s.clockOutTime);
  return jobShifts.reduce((total, shift) => {
    return total + getWorkedShiftMs(shift) / 3600000;
  }, 0);
}

/**
 * Get suggested labor hours from similar jobs.
 * Uses manual laborHours if set, otherwise falls back to recorded shift hours.
 * Returns average of all similar jobs' hours.
 * @param searchTerm Product name or part number
 * @param jobs All jobs
 * @param shifts All shifts (for calculating hours from completed shifts)
 * @returns Suggested hours (average), or 0 if no similar jobs found
 */
export function getLaborSuggestion(
  searchTerm: string,
  jobs: Job[],
  shifts: Array<{
    job: string;
    clockInTime: string;
    clockOutTime?: string;
    lunchStartTime?: string;
    lunchEndTime?: string;
    lunchMinutesUsed?: number;
  }>
): number {
  const similarJobs = findSimilarJobs(searchTerm, jobs);
  if (similarJobs.length === 0) return 0;

  const hours: number[] = [];

  for (const job of similarJobs) {
    // Prefer manual laborHours if set
    if (job.laborHours && job.laborHours > 0) {
      hours.push(job.laborHours);
    } else {
      // Fall back to recorded shift hours
      const shiftHours = calculateJobHoursFromShifts(job.id, shifts);
      if (shiftHours > 0) {
        hours.push(shiftHours);
      }
    }
  }

  if (hours.length === 0) return 0;

  // Return average
  const sum = hours.reduce((a, b) => a + b, 0);
  return Math.round((sum / hours.length) * 10) / 10; // Round to 1 decimal
}
