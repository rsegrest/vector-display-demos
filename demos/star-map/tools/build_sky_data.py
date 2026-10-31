#!/usr/bin/env python3
"""Builds src/data/sky.json, the star map's sky, from d3-celestial's data files.

d3-celestial (https://github.com/ofrohn/d3-celestial, BSD 3-Clause, Copyright (c) 2015 Olaf Frohn;
its license is copied to src/data/LICENSE-d3-celestial). Download its data/ files into a folder:

    for f in stars.6.json constellations.lines.json constellations.json mw.json starnames.json; do
      curl -sLO https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/$f
    done

then run, from demos/star-map:

    python3 -I tools/build_sky_data.py <that folder>

d3-celestial stores right ascension as a longitude from -180 to 180 degrees; here it is 0 to 360.
Positions are J2000 (the star map does not precess them: 26 years move stars a third of a degree).
"""
import json
import math
import sys
from pathlib import Path

# Proper names are kept for stars this bright or brighter; fainter ones would crowd the sky.
NAMED_STAR_MAGNITUDE = 3.5
# The Milky Way outline is thinned to points at least this far apart, in degrees.
MILKY_WAY_SPACING = 0.6
# Which of d3-celestial's five Milky Way contours to keep: the outer edge and the bright core.
MILKY_WAY_CONTOURS = ("ol1", "ol3")


def right_ascension(longitude: float) -> float:
    return round(longitude % 360.0, 3)


def point(coordinates) -> list:
    return [right_ascension(coordinates[0]), round(coordinates[1], 3)]


def angular_distance(a, b) -> float:
    ra1, dec1, ra2, dec2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    cosine = math.sin(dec1) * math.sin(dec2) + math.cos(dec1) * math.cos(dec2) * math.cos(ra1 - ra2)
    return math.degrees(math.acos(max(-1.0, min(1.0, cosine))))


def thinned(ring: list) -> list:
    kept = [ring[0]]
    for each in ring[1:]:
        if angular_distance(kept[-1], each) >= MILKY_WAY_SPACING:
            kept.append(each)
    return kept


def main(folder: Path, output: Path) -> None:
    stars_file = json.loads((folder / "stars.6.json").read_text())
    names_file = json.loads((folder / "starnames.json").read_text())
    stars = []
    for feature in stars_file["features"]:
        magnitude = float(feature["properties"]["mag"])
        color = feature["properties"].get("bv")
        color_index = round(float(color), 2) if color not in (None, "") else 0.6
        stars.append((magnitude, feature["id"], point(feature["geometry"]["coordinates"]), color_index))
    stars.sort(key=lambda star: star[0])

    named = []
    for index, (magnitude, hip, _position, _color) in enumerate(stars):
        name = names_file.get(str(hip), {}).get("name", "")
        if name and magnitude <= NAMED_STAR_MAGNITUDE:
            named.append([index, name])

    lines_by_id = {feature["id"]: feature for feature in json.loads((folder / "constellations.lines.json").read_text())["features"]}
    constellations = []
    for feature in json.loads((folder / "constellations.json").read_text())["features"]:
        identifier = feature["id"]
        properties = feature["properties"]
        lines = lines_by_id.get(identifier, {}).get("geometry", {}).get("coordinates", [])
        constellations.append(
            {
                "id": identifier,
                "name": properties.get("name") or properties.get("en"),
                "rank": int(properties.get("rank", 3)),
                "label": point(feature["geometry"]["coordinates"]),
                "lines": [[point(each) for each in line] for line in lines],
            }
        )

    milky_way = []
    for feature in json.loads((folder / "mw.json").read_text())["features"]:
        if feature["id"] not in MILKY_WAY_CONTOURS:
            continue
        for polygon in feature["geometry"]["coordinates"]:
            for ring in polygon:
                kept = thinned([point(each) for each in ring])
                if len(kept) >= 4:
                    milky_way.append({"contour": feature["id"], "points": kept})

    sky = {
        "source": "d3-celestial by Olaf Frohn (BSD 3-Clause): stars to magnitude 6 (Hipparcos), constellation lines and names, Milky Way outline",
        "stars": [[position[0], position[1], round(magnitude, 2), color] for magnitude, _hip, position, color in stars],
        "starNames": named,
        "constellations": constellations,
        "milkyWay": milky_way,
    }
    output.write_text(json.dumps(sky, separators=(",", ":")))
    print(f"{output}: {len(stars)} stars, {len(named)} named, {len(constellations)} constellations, {len(milky_way)} Milky Way rings, {output.stat().st_size // 1024} KB")


if __name__ == "__main__":
    here = Path(__file__).resolve().parent.parent
    main(Path(sys.argv[1]), here / "src" / "data" / "sky.json")
