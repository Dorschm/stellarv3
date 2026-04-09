# StellarGame 3D Asset List — Low-Poly GLB Models

All units, structures, projectiles, and terrain features that require GLB models.
Target: **10–30 polygons** per mesh. Use flat shading. No textures — vertex colors or a single solid material only.

---

## SHIPS (Mobile Units)

### 1. AssaultShuttle

**In-game role:** Moves troops between planets/territories across open space.

**Low-poly prompt:**
Create a 16-poly space assault shuttle. Start with a flat, elongated hexagonal prism for the hull — 8 faces, roughly 4 units long, 1.5 units wide, 0.8 units tall. Add a small rectangular box (4 faces) flush on top near the rear as the bridge/cockpit. Attach two flat, stubby rectangular fins (2 faces each) angled 45° outward from the rear underside. No curves. All edges sharp. Point the front end into a shallow wedge by collapsing the two front-top vertices downward slightly. Total: ~16 faces.

---

### 2. Battlecruiser

**In-game role:** Heavy combat vessel — attacks enemy ships and bombards territories.

**Low-poly prompt:**
Create a 20-poly space battlecruiser. Main hull: a long, narrow rectangular box (6 faces) 6 units long, 1.5 wide, 1 tall, with the bow pinched into a sharp horizontal wedge (add 2 triangular faces). Add a flat raised box (4 faces) amidships as the command tower. Attach two symmetric wing-like flat quad panels (2 faces each) extending from the midsection, angled slightly downward. Add a stubby forward-pointing rectangular gun barrel (2 faces) on the bow centerline. All geometry angular, no subdivision. Total: ~20 faces.

---

### 3. TradeFreighter

**In-game role:** Merchant vessel that moves credits/resources between territories.

**Low-poly prompt:**
Create a 14-poly space freighter. Make a wide, boxy rectangular hull (6 faces) — 3.5 units long, 2.5 wide, 1.2 tall, squat and fat. Add a large flat rectangular cargo container (4 faces) sitting on top of the hull, same footprint but half the height. Add a small pyramid (4 faces) at the rear top as the bridge. No fins, no weapons. Silhouette should read as a heavy cargo hauler — wide and blocky. Total: ~14 faces.

---

## FRIGATES (Hyperspace Lane Units)

### 4. FrigateEngine

**In-game role:** Engine head of a frigate convoy, pulling carriages along hyperspace lanes.

**Low-poly prompt:**
Create an 18-poly frigate engine. Main body: a rectangular box (6 faces) 4 units long, 1.8 wide, 1.5 tall. At the front, add a trapezoidal wedge (4 faces) as the nose cowling, lower and wider at the base. On top add a short cylindrical exhaust stack represented as a 4-sided prism (4 faces). Add two flat rectangular side skirts (2 faces each) low on the sides. The front face should be flat and prominent. Total: ~18 faces.

---

### 5. FrigateCarriage (Empty)

**In-game role:** Empty cargo car attached to the frigate engine.

**Low-poly prompt:**
Create a 10-poly frigate cargo car. A simple rectangular box (6 faces) 3 units long, 1.6 wide, 1.2 tall. Add a very thin flat rectangle (2 faces) on top as a roof panel, slightly overhanging the sides. Add two small rectangular connector nubs (1 face each) centered on the front and rear faces. Uniform, plain, boxy. Total: ~10 faces.

---

### 6. FrigateLoadedCarriage

**In-game role:** Cargo car loaded with troops or resources — visually heavier.

**Low-poly prompt:**
Create a 14-poly loaded cargo car. Same rectangular base as the empty carriage (6 faces). On top, add a large mound represented as a low 4-sided pyramid (4 faces) or a half-octahedron sitting in the cargo bay, indicating a full load. Add connector nubs front and rear (2 faces). The mound should visually bulge above the carriage walls. Total: ~14 faces.

---

## PROJECTILES & MUNITIONS

### 7. PlasmaBolt

**In-game role:** Energy projectile fired by battlecruisers — fast, small projectile.

**Low-poly prompt:**
Create an 8-poly plasma bolt. A 6-sided elongated cone (6 faces, lat segments=1, lon segments=6) — narrow at the tip, wider at the base, 2 units long, 0.6 units diameter at base. Add a flat circle cap (6 faces as a fan) at the base. Orientated nose-forward. Extremely simple — just a cone shape. Total: ~8 faces.

---

### 8. PointDefenseMissile

**In-game role:** Interceptor missile fired by Point Defense Arrays to shoot down incoming warheads.

**Low-poly prompt:**
Create a 12-poly point defense missile. Long thin 4-sided prism for the body (4 faces) — 0.4 units wide, 3 units long. At the nose, a 4-sided pyramid (4 faces). At the tail, 4 tiny flat triangular fins arranged in an X pattern around the base (4 faces, one triangle each). Sharp, dart-like silhouette. Total: ~12 faces.

---

### 9. AntimatterTorpedo

**In-game role:** Devastating area-of-effect weapon — medium destructive radius.

**Low-poly prompt:**
Create a 16-poly antimatter torpedo. A rounded fat body represented as a low-resolution sphere: use an icosphere with 1 subdivision (20 faces — acceptable at the upper end) OR a 6-sided barrel shape: top hexagon, bottom hexagon, 6 quad sides (18 faces). Add a small 4-sided pyramidal nose cone (4 faces) at one end and a flat rectangular tail fin cluster (4 fins as flat quads, 4 faces) at the other. Stocky and fat. Total: ~20 faces.

---

### 10. NovaBomb

**In-game role:** Thermonuclear weapon — largest destructive area, more devastating than antimatter torpedo.

**Low-poly prompt:**
Create a 20-poly nova bomb. Similar to AntimatterTorpedo but elongated: use an 8-sided cylinder (top octagon + bottom octagon + 8 quad sides = 18 faces). Add a pointed 8-sided cone nose (8 faces). Add 4 large swept-back triangular tail fins (4 faces). The overall shape should be longer and sleeker than the AntimatterTorpedo — an elongated cylinder aesthetic. Scale it 1.5x larger than the AntimatterTorpedo. Total: ~20 faces.

---

### 11. ClusterWarhead

**In-game role:** Multiple independently targetable warhead bus — one launch, splits into multiple submunitions.

**Low-poly prompt:**
Create an 18-poly cluster warhead bus. A short, wide 6-sided prism as the central bus body (top hex + bottom hex + 6 quad sides = 14 faces). Mounted around the equator, 3 tiny 4-sided pyramids (4 faces each, but share base) pointing outward at 120° intervals representing the submunitions pre-release — use just 3 extra triangular faces as nubs. A small cone at one end (6 faces) as the nose fairing. The overall shape reads as a squat cylinder bristling with warhead tips. Total: ~18 faces.

---

### 12. ClusterWarheadSubmunition

**In-game role:** Individual submunition released from a ClusterWarhead — small, fast, terminal-phase weapon.

**Low-poly prompt:**
Create an 8-poly cluster warhead submunition. A simple 4-sided pyramid (4 faces) with a flat rectangular base (2 faces) — like a tetrahedron but with a square base. 0.8 units wide, 1.5 units tall. Tiny and sharp. Add 4 tiny swept triangular fins at the base corners (4 faces). This is meant to be a very small object seen in groups. Total: ~8 faces.

---

## STRUCTURES (Buildings)

### 13. Colony

**In-game role:** Population center — generates income and troops, primary territory anchor.

**Low-poly prompt:**
Create a 24-poly space colony cluster. Three rectangular box towers of different heights clustered together: tallest center tower (6 faces, 1x1x3 units), medium left tower (6 faces, 0.8x0.8x2 units), short right tower (6 faces, 0.8x0.8x1.2 units). Add a flat octagonal base plate (8 faces as a flat octagon) connecting all three at ground level. Tops of towers are flat. No windows or detail. Silhouette reads clearly as a dense habitat cluster. Total: ~26 faces.

---

### 14. Spaceport

**In-game role:** Space dock — allows building ships and docking trade freighters.

**Low-poly prompt:**
Create a 22-poly spaceport. A flat hexagonal platform (12 faces — 6 top, 6 sides, closed bottom) as the landing pad base, 4 units across, 0.5 units tall. On top, 4 thin rectangular pillars (4 faces each x 2 = 8 faces) at the corners supporting a flat rectangular overhead gantry roof (4 faces). The open center is the docking bay. Total: ~22 faces.

---

### 15. Foundry

**In-game role:** Manufacturing facility — produces ships and military units.

**Low-poly prompt:**
Create a 20-poly space foundry. A large flat rectangular main building (6 faces) 5 units long, 3 wide, 1.5 tall. Add two short 4-sided exhaust prisms (4 faces each) on the roof, offset to left and right of center. Add a wide flat rectangular loading bay extension (4 faces) protruding from one long side. Add a small box control module (4 faces) on the roof center. Total: ~20 faces.

---

### 16. OrbitalStrikePlatform

**In-game role:** Orbital launch facility — fires AntimatterTorpedoes, NovaBombs, and ClusterWarheads.

**Low-poly prompt:**
Create a 16-poly orbital strike platform. A wide flat circular platform: use a 6-sided polygon disk (6 top faces as a fan + 6 side faces = 12 faces) 4 units diameter, 0.8 tall. In the center, a 6-sided cylindrical shaft opening (represented as a dark 6-sided hole rim with 6 thin vertical quad faces = 6 faces) recessed into the top. Add 2 small rectangular blast door panels (2 faces each) hinged open at the top. Total: ~16 faces.

---

### 17. DefenseStation

**In-game role:** Planet-side defense station — fires at incoming units.

**Low-poly prompt:**
Create an 18-poly defense station. A 6-sided base bunker (top hex + 6 sides = 12 faces) 2 units across, 1 unit tall, slightly tapered. On top, a rotating turret represented as a short 4-sided box (4 faces). Protruding from the turret box, 2 parallel thin rectangular gun barrels (1 face each as flat quads). Total: ~18 faces.

---

### 18. PointDefenseArray

**In-game role:** Anti-warhead defense system — intercepts incoming torpedoes and bombs mid-flight.

**Low-poly prompt:**
Create a 20-poly point defense array. A squat 4-sided base box (6 faces) 2 units x 2 units x 0.8 tall as the platform chassis. On top, a 4-sided rotating platform box (4 faces). From the platform, 3 long thin 4-sided prisms (4 faces each) angled upward at 60° in a fan arrangement representing missile tubes ready to fire. Total: ~20 faces.

---

## TERRAIN FEATURES

> Note: Terrain is primarily rendered as a textured plane. However, these feature meshes may be instanced as landmarks or map decorators.

### 19. AsteroidField

**In-game role:** Impassable terrain feature — decorative landmark on maps.

**Low-poly prompt:**
Create an 8-poly asteroid formation. Use a 4-sided pyramid: 4 triangular faces, flat square base, very tall and sharp — 1 unit base, 3 units tall. For a cluster variation, group 3 such pyramids at different scales and slight rotations to suggest a rocky debris field.

---

### 20. Nebula

**In-game role:** Elevated terrain — slower movement, some defensive bonus.

**Low-poly prompt:**
Create a 6-poly nebula plateau. A simple rectangular box (6 faces) — 3 units x 3 units x 0.6 tall, with the top face flat. Edges are sharp, no beveling. Represents a raised flat-topped terrain chunk. Very simple box shape.

---

### 21. SpaceLandmark (Generic)

**In-game role:** Visual marker placed on planets to indicate terrain variety or points of interest.

**Low-poly prompt:**
Create a 10-poly alien crystal/formation. A central tall 6-sided prism (simplified to a 4-sided tall box = 4 side faces + top = 6 faces) 0.5 wide x 0.5 wide x 2 tall. Surrounded by 2 smaller leaning 4-sided prisms (4 faces each) at slight outward angles. Abstract, alien crystal cluster aesthetic. Total: ~10 faces.

---

## EFFECTS (Procedural — geometry hints)

> These are animated effects. Rather than static GLB files, they use procedurally generated Three.js geometry. Listed here for completeness — GLB models are NOT required, but reference geometry is described.

### 22. Explosion

**Procedural effect:** Expanding sphere burst. Use `SphereGeometry(r, 6, 6)` with flat shading, opacity fade. Scale from 0 -> maxRadius over duration.

### 23. Shockwave Ring

**Procedural effect:** Expanding torus ring. Use `TorusGeometry(r, 0.2, 4, 16)` lying flat (X-axis). Scale radius from 0 outward.

### 24. Conquest Pulse

**Procedural effect:** Expanding flat disk. Use `CylinderGeometry(r, r, 0.1, 8)` scaling outward with opacity fade.

### 25. Spawn Effect

**Procedural effect:** Imploding sphere that appears and shrinks inward. Use `IcosahedronGeometry(r, 0)` with 20 faces.

---

## SUMMARY TABLE

| #   | Asset                     | Category   | Target Polys | Priority |
| --- | ------------------------- | ---------- | ------------ | -------- |
| 1   | AssaultShuttle            | Ship       | 16           | High     |
| 2   | Battlecruiser             | Ship       | 20           | High     |
| 3   | TradeFreighter            | Ship       | 14           | High     |
| 4   | FrigateEngine             | Frigate    | 18           | Medium   |
| 5   | FrigateCarriage           | Frigate    | 10           | Medium   |
| 6   | FrigateLoadedCarriage     | Frigate    | 14           | Medium   |
| 7   | PlasmaBolt                | Projectile | 8            | High     |
| 8   | PointDefenseMissile       | Projectile | 12           | High     |
| 9   | AntimatterTorpedo         | Projectile | 20           | High     |
| 10  | NovaBomb                  | Projectile | 20           | High     |
| 11  | ClusterWarhead            | Projectile | 18           | High     |
| 12  | ClusterWarheadSubmunition | Projectile | 8            | High     |
| 13  | Colony                    | Structure  | 24           | High     |
| 14  | Spaceport                 | Structure  | 22           | High     |
| 15  | Foundry                   | Structure  | 20           | High     |
| 16  | OrbitalStrikePlatform     | Structure  | 16           | High     |
| 17  | DefenseStation            | Structure  | 18           | High     |
| 18  | PointDefenseArray         | Structure  | 20           | High     |
| 19  | AsteroidField             | Terrain    | 5-8          | Low      |
| 20  | Nebula                    | Terrain    | 6            | Low      |
| 21  | SpaceLandmark             | Terrain    | 10           | Low      |

**Total static GLB models needed: 21**
**Procedural effects (no GLB needed): 4**

---

## MODELING NOTES

- **Scale reference:** 1 game unit = 1 blender unit. Structures sit on a flat plane; ships hover 5 units above it.
- **Coordinate system:** Y-up for GLB export (Three.js default). Some units may need rotation offsets applied in engine.
- **Materials:** Single flat-shaded material per mesh. No PBR, no normal maps. Vertex colors optional.
- **Export:** GLB format, Draco compression optional, no embedded textures.
- **Pivot point:** Center of bounding box for ships/projectiles. Bottom-center for structures (they sit on terrain).
- **LOD:** At this poly count, no LOD needed — these meshes ARE the LOD.
