import * as THREE from "three";
import { VOXLoader, VOXMesh } from "three/addons/loaders/VOXLoader.js";

/**
 * Load MagicaVoxel (.vox) files and place them in the world.
 *
 * Drop .vox files into game4/assets/vox/, list them in MANIFEST below
 * with placement info, and they'll appear at the right spot — sitting on
 * the dunes with shadows. Missing files just warn (everything else still
 * works), so you can iterate one piece at a time.
 *
 * Coordinates: world meters. The model's voxel-grid center sits at
 * (x, terrainY + sinkY, z); rotY is in radians; scale is meters per voxel
 * (≈ 0.08 reads as a chunky ~2–3m totem if your model is ~30 voxels tall).
 */
const MANIFEST = [
  // Pilgrim's row between spawn (z = -200) and the tower (z = -340).
  // These will only render if you drop a totem.vox into assets/vox/.
  { url: "./assets/vox/totem.vox",  x:  3.5, z: -220, scale: 0.08, rotY:  0.2,  sinkY: -0.05 },
  { url: "./assets/vox/totem.vox",  x: -4.0, z: -250, scale: 0.08, rotY: -0.4,  sinkY: -0.05 },
  { url: "./assets/vox/totem.vox",  x:  2.5, z: -280, scale: 0.08, rotY:  0.7,  sinkY: -0.05 },
  { url: "./assets/vox/totem.vox",  x: -3.0, z: -310, scale: 0.08, rotY: -0.15, sinkY: -0.05 },

  // A larger hand-modeled shrine near the tower plaza, if you make one.
  { url: "./assets/vox/shrine.vox", x:  0.0, z: -325, scale: 0.12, rotY:  0,    sinkY: -0.1  },
];

export function buildVox(scene, world, manifest = MANIFEST) {
  const loader = new VOXLoader();
  const groups = [];

  for (const item of manifest) {
    const placeholder = new THREE.Group();
    scene.add(placeholder);
    groups.push(placeholder);

    loader.load(
      item.url,
      (chunks) => {
        for (const chunk of chunks) {
          const mesh = new VOXMesh(chunk);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          // VOXMesh comes in as MeshStandardMaterial w/ vertex colors;
          // give it a touch of roughness so it reads weathered, not plastic.
          if (mesh.material) {
            mesh.material.roughness = 0.95;
            mesh.material.metalness = 0.0;
          }
          placeholder.add(mesh);
        }
        const scale = item.scale ?? 0.08;
        placeholder.scale.setScalar(scale);
        const groundY = world.getHeight(item.x, item.z);
        placeholder.position.set(item.x, groundY + (item.sinkY ?? 0), item.z);
        placeholder.rotation.y = item.rotY ?? 0;
      },
      undefined,
      (err) => {
        // missing/broken file — keep going, just note it
        console.info(`[vox] skipped ${item.url} (${err?.message ?? "not found"})`);
      },
    );
  }

  return { groups };
}
