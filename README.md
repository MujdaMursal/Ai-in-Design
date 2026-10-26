# How far can you walk?

A 3D map of central Weimar that shows how far you can walk from any point in 5, 10 and 15 minutes, which buildings you reach, and about how many people live there.

Click on the ground. The app finds the nearest junction of the pedestrian network and walks along the streets from there. It draws three nested areas in three shades of blue and colours the buildings that touch each area in the matching shade. A panel lists, for each area, the number of buildings reached and about how many residents live there. Before you click, buildings are coloured by their main use, and a legend names each colour.

A second page, `corridor.html`, is a 3D map of the area between the Bauhaus-Universität main building and Weimar Hauptbahnhof. It shows every building within 250 m of the straight line between the two, coloured by use, with both buildings labelled in orange and the shortest walk between them in blue (about 2.1 km, 26 minutes). The kit has no building names, so the two buildings were picked by their location (ids `14780` and `22132`). The panel sums up the buildings in the area: count and floor area per main use, and the range of heights. Click a building to see its use, height, floors and floor area by use. Floor areas are estimates for the whole building, not surveyed. Each page links to the other.

A third page, `flood.html`, is a game: "Weimar under water". A slider raises the water from 0 to 40 m, and more and bigger fish and boats appear as it rises, from small fish and rubber dinghies to sharks, whales, a kraken and cruise ships. A click drops a screaming person: fish and sharks race the boats to reach them. Fish level up by eating and grow with every level; badges over the fish and a progress panel show their levels and your own. Once the kraken has grown, it hunts boats up to half its length, and the boats flee. The sounds are made in the browser, with no sound files, and can be muted. It is not a flood model. The kit has no ground heights, so the whole area floods evenly like a bathtub. Only the building heights are real.

## Run it

```
npm install     install the packages
npm run dev     start the app at http://localhost:5173
```

Drag to orbit, right-drag to pan, scroll to zoom. Every push to `main` publishes the app on GitHub Pages at `https://<user>.github.io/<repo>/`.

## Method and its limits

- **Walking speed.** 4.8 km/h, which is 80 m per minute, so 400, 800 and 1200 m for 5, 10 and 15 minutes. The walk follows the edges of the pedestrian network in both directions, using their `length` in metres. Slopes, steps, crossings and waiting times are ignored.
- **Start.** The walk starts at the network node (junction or dead end) nearest to the click. The distance from the click to that node isn't counted. If no walkable street lies within 100 m of the click, the app says so and doesn't walk.
- **The 25 m band.** Each area is the street segments reached in that time, including the reachable part of the last segment. A band of 25 m is drawn on each side, and the bands are joined into one shape. It is not a circle or a convex hull, so it shows only what lies along the streets.
- **Buildings.** A building counts when its footprint touches the area. Each building counts once per area, and the areas are nested, so the 15-minute count includes the 10- and 5-minute buildings.
- **Residents.** From the Zensus 2022 grid of 100 m squares. Every square that overlaps the area adds its population times the share of the square's area that lies inside. The total is rounded to the nearest 10. This assumes people are spread evenly within each square, which they aren't: a square that is half park and half housing is shared out by area, not by where the flats are. The census also changes small counts slightly at random to protect privacy, so single squares are approximate.
- **Squares without a figure.** Some squares have no published population (`null`). They aren't zero: they are left out of the sum, and the panel shows how many such squares overlap the area. In this kit that is one square.
- **Edge of the kit.** The data stops at the edge of the kit area, so walks near the edge are cut short.

## Data

All data is in `public/data/`, described in `public/data/SOURCES.md`. The app fetches nothing from the internet.

| File | Used for | Source | Licence |
| --- | --- | --- | --- |
| `buildings.geojson` | footprints, heights in metres, main use | 3D building models LoD2 of Thuringia, © GDI-Th; uses: Egor Gaydukov | dl-de/by-2-0 |
| `streets.graph.json` | the walking network, lengths in metres | pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar | |
| `zensus.geojson` | residents per 100 m square | Zensus 2022, © Statistische Ämter des Bundes und der Länder | dl-de/by-2-0 |

Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).

## How this was made

1. Tools: Claude Code, with the model Claude Opus 5.5.
2. I decided:
3. The agent did: read the city kit, wrote the 3D app (React Three Fiber), the walking and census calculation and this README, and tested the calculation and the Pages build.
4. I checked:
