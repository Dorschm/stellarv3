import { BufferGeometry, Euler, Matrix4, Mesh, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// One loader instance shared across all asynchronous loads.
const _loader = new GLTFLoader();

/**
 * Load a GLB file and return a single merged BufferGeometry that can be
 * dropped into an InstancedMesh.
 *
 * The result is baked so that no per-frame transform is needed beyond the
 * instance position/color:
 *
 *  1. Each mesh's world transform (from the GLB scene graph) is applied to
 *     its vertices so multi-mesh hierarchies collapse to a single buffer.
 *  2. Geometries are stripped to position+normal (+ per-mesh index removed
 *     via `toNonIndexed`) so `mergeGeometries` doesn't choke on mismatched
 *     attribute sets across the GLB's child meshes.
 *  3. The merged geometry is rotated from Y-up (glTF convention) to Z-up
 *     (this scene's convention — see SpaceMapPlane / UnitRenderer comments).
 *  4. It is uniformly scaled so its longest bounding-box axis matches
 *     `targetSize` world units — roughly matching the proxy primitives we
 *     replace so the visual footprint stays comparable.
 *  5. It is centered on the origin so `setMatrixAt` can place the instance
 *     directly at the unit's world position.
 */
export function loadGltfGeometry(
  url: string,
  targetSize: number,
): Promise<BufferGeometry> {
  return new Promise((resolve, reject) => {
    _loader.load(
      url,
      (gltf) => {
        try {
          gltf.scene.updateMatrixWorld(true);

          const pieces: BufferGeometry[] = [];
          gltf.scene.traverse((child) => {
            const mesh = child as Mesh;
            if (!mesh.isMesh || !mesh.geometry) return;

            // Clone so we don't mutate the cached GLTF buffers.
            let g = (mesh.geometry as BufferGeometry).clone();
            g.applyMatrix4(mesh.matrixWorld);

            // Normalize attribute set: keep only position + normal so
            // merging across meshes with different attribute layouts works.
            const position = g.getAttribute("position");
            if (!position) return;
            const simplified = new BufferGeometry();
            simplified.setAttribute("position", position);
            const normal = g.getAttribute("normal");
            if (normal) simplified.setAttribute("normal", normal);
            if (g.index) simplified.setIndex(g.index);
            g.dispose();
            g = simplified;

            // Strip the index — merging non-indexed geometries is the
            // most compatible path across varied GLB exports.
            if (g.index) g = g.toNonIndexed();
            pieces.push(g);
          });

          if (pieces.length === 0) {
            reject(new Error(`GLB at ${url} contained no mesh geometries`));
            return;
          }

          const merged =
            pieces.length === 1 ? pieces[0] : mergeGeometries(pieces, false);
          if (!merged) {
            reject(new Error(`Failed to merge GLB geometries from ${url}`));
            return;
          }
          // mergeGeometries returns a new buffer when merging >1 inputs;
          // dispose the now-unreferenced piece copies in that case.
          if (pieces.length > 1) {
            for (const p of pieces) p.dispose();
          }

          // Rotate from Y-up → Z-up.
          merged.applyMatrix4(
            new Matrix4().makeRotationFromEuler(new Euler(Math.PI / 2, 0, 0)),
          );

          // Normalize size by longest bounding-box axis.
          merged.computeBoundingBox();
          const size = new Vector3();
          merged.boundingBox!.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z);
          if (maxDim > 0 && Number.isFinite(maxDim)) {
            const s = targetSize / maxDim;
            merged.applyMatrix4(new Matrix4().makeScale(s, s, s));
          }

          // Center on XY origin. Keep Z centered too; the engine places
          // the instance at UNIT_HOVER_HEIGHT (mobile) or a per-structure
          // height, and both expect the geometry's centroid at z≈0.
          merged.computeBoundingBox();
          const center = new Vector3();
          merged.boundingBox!.getCenter(center);
          merged.applyMatrix4(
            new Matrix4().makeTranslation(-center.x, -center.y, -center.z),
          );

          merged.computeBoundingBox();
          merged.computeBoundingSphere();
          // Recompute normals so shading stays consistent after the stack
          // of transforms above (especially the non-uniform cases where
          // the GLB scene graph applied per-child rotations).
          merged.computeVertexNormals();

          resolve(merged);
        } catch (err) {
          reject(err);
        }
      },
      undefined,
      (err) => reject(err),
    );
  });
}
