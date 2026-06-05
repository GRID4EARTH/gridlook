# gridlook

GridLook is a WebGL-based viewer for Earth system model (ESM) output. It supports cloud-hosted Zarr datasets.

![](docs/assets/showcase.webp)

## HEALPix & DGGS support

This GRID4EARTH build adds native support for **ellipsoidal HEALPix** grids
following the [DGGS Zarr convention](https://github.com/zarr-conventions/dggs),
powered by [`@eopf-dggs/healpix-geo`](https://github.com/EOPF-DGGS/healpix-geo):

- HEALPix pixels defined on the **WGS84 ellipsoid** (DGGS `ellipsoid: WGS84`),
  with authalic→geodetic latitude correction so the data aligns with coastlines.
- DGGS metadata read from the dataset group attributes (`attrs.dggs`): the cell
  coordinate name (`dggs.coordinate`) and ellipsoid (`dggs.ellipsoid.name`),
  with fallbacks for `cell` / `cell_ids` coordinates.
- Full **Zarr v3** support (via zarrita, incl. blosc/zstd/lz4 codecs).

Plain spherical HEALPix datasets continue to render exactly as before; the
ellipsoidal path is only taken when ellipsoid metadata is present.

## Try It Live

This build is deployed to GitHub Pages:

https://grid4earth.github.io/gridlook/

You can view any CORS-enabled, public Zarr dataset with GridLook:

```
https://grid4earth.github.io/gridlook/#<ZARR_URI>
```

Gridlook can also load catalog JSON files that list multiple datasets. The catalog format and deployment options are documented in [docs/catalogs.md](docs/catalogs.md).

A guide to the viewer keyboard, mouse, and touch interaction is available in [docs/Controls.md](docs/Controls.md).

## Project Setup

This project uses [Node.js](https://nodejs.org/en) and [vue.js](https://vuejs.org/)

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Type-Check, Compile and Minify for Production

```sh
npm run build
```

### Lint with [ESLint](https://eslint.org/)

```sh
npm run lint
```

### Customize configuration

See [Vite Configuration Reference](https://vitejs.dev/config/).

## Usage

The project is served at http://localhost:3000/ when you run `npm run dev`.

## CORS & Hosting Notes

To load datasets from services like DKRZ Swift, ensure [CORS](https://developer.mozilla.org/de/docs/Web/HTTP/Guides/CORS) is enabled on the server.

Example for the nextGEMS container on Swift:

```
swift post nextGEMS -m "X-Container-Meta-Access-Control-Allow-Origin:*"
```

This allows GridLook to fetch data directly from the container in your browser.
