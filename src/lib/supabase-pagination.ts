/**
 * Fetches all rows from a PostgREST/Supabase query by paging in fixed chunks
 * (default 1000 rows, matching Supabase's standard server max-rows ceiling).
 */
export async function fetchAllPages<T>(
  fetchPage: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;
  const maxPages = 100; // Safety guard (up to 100,000 rows)

  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await fetchPage(offset, offset + pageSize - 1);
    if (error) {
      throw error;
    }

    const batch = data || [];
    results.push(...batch);

    if (batch.length < pageSize) {
      break;
    }
    offset += pageSize;
  }

  return results;
}
