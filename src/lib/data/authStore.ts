import * as zarr from "zarrita";

/**
 * Create a FetchStore for public, CORS-enabled Zarr datasets.
 *
 * (EGI DataHub / token-authenticated store support has been removed in this
 * build — datasets are expected to be publicly accessible.)
 */
export function createFetchStore(
  url: string | URL,
  options: { useSuffixRequest?: boolean } = {}
): zarr.FetchStore {
  return new zarr.FetchStore(url, options);
}
