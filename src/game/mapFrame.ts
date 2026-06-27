import type { TileOrigin } from "./content/maps/mapTypes";

export class MapFrame {
  private readonly originLat: number;
  private readonly originLon: number;
  private readonly metersPerDegreeLat: number;
  private readonly metersPerDegreeLon: number;

  constructor(tileOrigin: TileOrigin) {
    this.originLat = tileOrigin.lat;
    this.originLon = tileOrigin.lon;
    this.metersPerDegreeLat = 111320;
    this.metersPerDegreeLon = 111320 * Math.cos((tileOrigin.lat * Math.PI) / 180);
  }

  gameXZtoLatLon(x: number, z: number): { lat: number; lon: number } {
    return {
      lat: this.originLat - z / this.metersPerDegreeLat,
      lon: this.originLon + x / this.metersPerDegreeLon,
    };
  }

  latLonToGameXZ(lat: number, lon: number): { x: number; z: number } {
    return {
      x: (lon - this.originLon) * this.metersPerDegreeLon,
      z: -(lat - this.originLat) * this.metersPerDegreeLat,
    };
  }
}
