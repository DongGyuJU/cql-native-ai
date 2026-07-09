// src/index.ts
// CQL Native AI — Category Theory-based Multi-Agent framework.
//
//   Domain            = Category            (DomainDefinition / DomainSchema)
//   Instance          = Set-valued Functor   (Instance, checkInstanceIsFunctor)
//   Domain Agent      = Functor              (DomainAgent)
//   Agent-to-agent    = Natural Transform.   (NaturalTransformation / DomainInsight)
//   Meta Agent        = Lax Colimit          (MetaAgent)
//   Domain Registry   = Index Category       (DomainRegistry)

export {
  DomainInsight,
  UnifiedInsight,
  DomainDefinition,
  DomainRelation,
  HistoryEntry,
  AnalyzeOptions,
  InsightStatus,
  errorInsight,
} from './types';

export {
  AttributeType,
  AttributeDef,
  ObjectDef,
  MorphismDef,
  DomainSchema,
  PathEquation,
  Row,
  Instance,
  FunctorViolationReason,
  FunctorViolation,
  FunctorCheckReport,
  PathEndpointsResult,
  checkInstanceIsFunctor,
  resolvePathEndpoints,
  pathsAreDeclaredEqual,
  InstanceBuilder,
  describeSchema,
  describeMorphisms,
} from './schema';

export {
  SchemaMapping,
  SchemaMappingViolationReason,
  SchemaMappingViolation,
  SchemaMappingCheckReport,
  checkSchemaMappingLaws,
  deltaF,
  withDerivedAttributes,
} from './schemaMapping';

export { sigmaF, piF, JoinObjectDef } from './kanExtensions';

export { DomainAgent, createAgent, AnalyzeFn } from './agent';
export { DomainRegistry } from './registry';
export {
  NaturalTransformation,
  DomainTranslation,
  TransformResult,
  NaturalityReport,
} from './transform';
export { MetaAgent, MetaSynthesizer, TemplateSynthesizer, MetaRunInput } from './meta';
export {
  validateInsight,
  isValidInsight,
  coerceInsight,
  InsightValidationError,
} from './validate';
export {
  LLMProvider,
  OpenAICompatProvider,
  groqProvider,
  createLLMAgent,
  LLMAgentConfig,
  createLLMSynthesizer,
  extractJSON,
} from './providers';
