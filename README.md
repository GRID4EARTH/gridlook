# GridLook

GridLook is a WebGL-based 3D globe viewer for Earth system data stored as cloud-hosted [Zarr](https://zarr.dev/) datasets. It runs entirely in the browser with no server-side processing.

![](docs/assets/showcase.webp)

## HEALPix & DGGS Support

This branch (`healpix-geo`) extends GridLook with native support for [HEALPix](https://healpix.jpl.nasa.gov/) grids and the [DGGS Zarr convention](https://github.com/zarr-conventions/dggs):

- **HEALPix nested indexing** on the WGS84 ellipsoid (EPSG:4326), powered by [`@eopf-dggs/healpix-geo`](https://github.com/EOPF-DGGS/healpix-geo)
- **Multiscale pyramids** with automatic level-of-detail (LOD) switching based on zoom level
- **DGGS metadata** read from Zarr group attributes (`attrs.dggs`) following the [DGGS Zarr convention](https://github.com/zarr-conventions/dggs)
- **Limited-area optimization** for datasets that cover only a portion of the sphere (compact geometry and texture)

### Supported Grid Types

| Grid Type | Description |
|-----------|-------------|
| **HEALPix** | Hierarchical Equal Area isoLatitude Pixelisation (nested) |
| Regular | Equirectangular latitude/longitude |
| Regular Rotated | Rotated-pole regular grids |
| Curvilinear | Model-native curvilinear grids |
| Gaussian Reduced | Reduced Gaussian grids (e.g. IFS output) |
| Triangular | Unstructured triangular meshes |
| Irregular | Scattered point data (Delaunay triangulation) |

Grid type is auto-detected from the Zarr metadata — no user configuration needed.

## Try It Live

Visit the deployed viewer:

https://eopf-dggs.github.io/gridlook/

Load any CORS-enabled, public Zarr dataset by appending its URI to the URL:

```
https://eopf-dggs.github.io/gridlook/#<ZARR_URI>
```

## URL-Driven State

All viewer state is encoded in the URL hash for shareable links:

```
https://eopf-dggs.github.io/gridlook/#<ZARR_URI>::variable=temperature&colormap=viridis
```

## Project Setup

Requires [Node.js](https://nodejs.org/) (v20+).

```sh
npm install
```

### Development

```sh
npm run dev         # dev server on localhost:3000
```

### Production Build

```sh
npm run build       # type-check + production build
```

### Lint

```sh
npm run lint-ci     # ESLint (zero warnings)
npm run lint:fix    # auto-fix
npm run typecheck   # vue-tsc type checking
```

## CORS & Hosting Notes

To load datasets from object storage services, ensure [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) is enabled on the server.

Example for an OpenStack Swift container:

```
swift post nextGEMS -m "X-Container-Meta-Access-Control-Allow-Origin:*"
```

## License

See [LICENSE](LICENSE).
