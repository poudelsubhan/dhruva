/**
 * Dhruva core components — the frozen visual contract.
 *
 * Five primitives, five Phase 2 tasks building against them. Props here are the
 * interface; changing a signature stops the phase.
 */

export { CheckpointDiamond, type CheckpointDiamondProps } from './CheckpointDiamond'
export { CoherenceChart, type ChartPoint, type CoherenceChartProps } from './CoherenceChart'
export {
  CoherenceGauge,
  DEFAULT_THRESHOLDS,
  verdictFor,
  type CoherenceGaugeProps,
  type CoherenceThresholds,
  type CoherenceVerdict,
} from './CoherenceGauge'
export {
  EVENT_GLYPH_SHAPES,
  EVENT_LABELS,
  EVENT_TYPES,
  EventGlyph,
  type EventGlyphProps,
  type EventType,
} from './EventGlyph'
export { Panel, type PanelProps } from './Panel'
export {
  TimelineTrack,
  type TimelineArc,
  type TimelineEvent,
  type TimelineTrackProps,
} from './TimelineTrack'
