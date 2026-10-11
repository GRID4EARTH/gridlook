<script lang="ts" setup>
import { useEventListener } from "@vueuse/core";
import { ref, onBeforeMount, type Ref } from "vue";

import GlobeView from "./GlobeView.vue";

import { GRID_TYPES, type T_GRID_TYPES } from "@/lib/data/gridTypeDetector.ts";
import {
  STORE_PARAM_MAPPING,
  useUrlParameterStore,
} from "@/store/paramStore.ts";
import { useGlobeControlStore } from "@/store/store.ts";
import { isDisplayMode, isPresenterActive } from "@/store/usePresenterSync.ts";
import type { TURLParameterValues } from "@/utils/urlParams.ts";

type TParams = Partial<Record<TURLParameterValues, string>>;

// GRID4EARTH: global ERA5 on HEALPix (WGS84 ellipsoid), also in the catalog below
const DEFAULT_DATASET =
  "https://data.grid4earth.eu/auxiliary/reanalysis-era5-complete/S00__ADF_ECMWA_20180504T210000_20180504T210000_20260619T111831.zarr";
const DEFAULT_VARNAME = "measurements/enda/t2m";

// GRID4EARTH: written by `stac-scraper gridlook-catalog` with the STAC metadata
const DEFAULT_CATALOG = "https://data.grid4earth.eu/gridlook-catalog.json";
const DEFAULT_BASEMAP_CATALOG = "static/basemaps.json";

const defaultSrc = ref(DEFAULT_DATASET);
const src = ref(DEFAULT_DATASET);
const params: Ref<TParams> = ref({});

const store = useGlobeControlStore();

const urlParameterStore = useUrlParameterStore();

const onHashChange = () => {
  if (location.hash.length > 1) {
    if (isDisplayMode.value || isPresenterActive.value) {
      urlParameterStore.resetExceptCamera();
    } else {
      urlParameterStore.$reset();
    }
    // The hash is of the form "#resource::param1=value1::param2=value2::..."
    // We split on "::" to separate the resource from the parameters
    // and then parse the parameters and set the store values accordingly
    const [resource, ...paramArray] = location.hash.substring(1).split("::");
    const paramString = paramArray.join("&");

    params.value = Object.fromEntries(new URLSearchParams(paramString));

    for (const [key, value] of Object.entries(params.value) as [
      keyof typeof STORE_PARAM_MAPPING,
      string,
    ][]) {
      if (key.startsWith("dimIndices_")) {
        urlParameterStore[STORE_PARAM_MAPPING.dimIndices][
          key.substring("dimIndices_".length)
        ] = value;
      } else if (key.startsWith("dimMinBounds_")) {
        urlParameterStore[STORE_PARAM_MAPPING.dimMinBounds][
          key.substring("dimMinBounds_".length)
        ] = value;
      } else if (key.startsWith("dimMaxBounds_")) {
        urlParameterStore[STORE_PARAM_MAPPING.dimMaxBounds][
          key.substring("dimMaxBounds_".length)
        ] = value;
      } else if (STORE_PARAM_MAPPING[key] === STORE_PARAM_MAPPING.gridtype) {
        // Simple input validation: Check if the provided gridtype is a real grid type
        if (!Object.values(GRID_TYPES).includes(value as T_GRID_TYPES)) {
          continue;
        }
      } else if (STORE_PARAM_MAPPING[key] === undefined) {
        continue;
      }
      const paramProperty = STORE_PARAM_MAPPING[key];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      urlParameterStore[paramProperty] = value as any;
    }
    src.value = resource || defaultSrc.value;
    store.catalogUrl = params.value.catalog || DEFAULT_CATALOG;
    store.basemapCatalogUrl =
      params.value.basemapcatalog || DEFAULT_BASEMAP_CATALOG;
  } else {
    store.catalogUrl = DEFAULT_CATALOG;
    store.basemapCatalogUrl = DEFAULT_BASEMAP_CATALOG;
    urlParameterStore.paramVarname = DEFAULT_VARNAME;
    src.value = defaultSrc.value;
  }
};

useEventListener(window, "hashchange", onHashChange);

onBeforeMount(() => {
  onHashChange();
});
</script>

<template>
  <GlobeView :src="src" />
</template>
