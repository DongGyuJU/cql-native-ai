// city-infra/schema.ts
// Three heterogeneous domain schemas modeling a city's infrastructure
// monitoring layer, at realistic density ratios (Phase A DomainSchema
// form, so the FDM layer benchmark can exercise checkInstanceIsFunctor
// / deltaF / sigmaF on the same topology as the agent-runtime benchmark).

import { DomainSchema } from '../src/schema';

export interface RoadSegmentInput {
  segmentId: string;
  vehiclesPerMin: number;
  avgSpeedKmh: number;
  queueMeters: number;
}

export interface IntersectionInput {
  intersectionId: string;
  signalPhase: 'red' | 'yellow' | 'green';
  queuedVehicles: number;
}

export interface AirQualityInput {
  stationId: string;
  pm25: number;
  no2: number;
}

export const roadSegmentTypedSchema: DomainSchema = {
  objects: {
    RoadSegment: {
      attributes: [
        { name: 'name', type: 'string' },
        { name: 'avgSpeedKmh', type: 'number' },
        { name: 'vehiclesPerMin', type: 'number' },
        { name: 'queueMeters', type: 'number' },
      ],
    },
  },
  morphisms: [{ name: 'connectsTo', from: 'RoadSegment', to: 'RoadSegment' }],
};

export const intersectionTypedSchema: DomainSchema = {
  objects: {
    Intersection: {
      attributes: [
        { name: 'signalPhase', type: 'string' },
        { name: 'queuedVehicles', type: 'number' },
      ],
    },
    RoadSegment: { attributes: [{ name: 'name', type: 'string' }] },
  },
  morphisms: [{ name: 'controls', from: 'Intersection', to: 'RoadSegment' }],
};

export const airQualityTypedSchema: DomainSchema = {
  objects: {
    AirQualityStation: {
      attributes: [
        { name: 'pm25', type: 'number' },
        { name: 'no2', type: 'number' },
      ],
    },
    RoadSegment: { attributes: [{ name: 'name', type: 'string' }] },
  },
  morphisms: [{ name: 'monitors', from: 'AirQualityStation', to: 'RoadSegment' }],
};

// A unified "CityInfra" schema that all three feed into via Sigma_F —
// used by the FDM-layer benchmark to test cross-schema integration at
// city scale, not just single-domain replication.
export const unifiedCitySchema: DomainSchema = {
  objects: {
    Asset: { attributes: [{ name: 'name', type: 'string' }] },
  },
  morphisms: [],
};

// The combined schema (all three domains' objects/morphisms together)
// used directly for the Phase A benchmark: this is what a single
// checkInstanceIsFunctor call sees when a city-scale instance spans
// all three domain types at once.
export const combinedCitySchema: DomainSchema = {
  objects: {
    ...roadSegmentTypedSchema.objects,
    ...intersectionTypedSchema.objects,
    ...airQualityTypedSchema.objects,
  },
  morphisms: [
    ...roadSegmentTypedSchema.morphisms,
    ...intersectionTypedSchema.morphisms,
    ...airQualityTypedSchema.morphisms,
  ],
};
