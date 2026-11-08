type BundledExtensionCtor = new (
  url: string,
  name: string,
  productName?: string,
  active?: boolean,
  description?: string,
  version?: string
) => import('@rey30-idvj/core').BaseExtension

declare module '@rey30-idvj/assistant-extension' {
  const ext: BundledExtensionCtor
  export default ext
}
declare module '@rey30-idvj/download-extension' {
  const ext: BundledExtensionCtor
  export default ext
}
declare module '@rey30-idvj/llamacpp-extension' {
  const ext: BundledExtensionCtor
  export default ext
}
declare module '@rey30-idvj/mlx-extension' {
  const ext: BundledExtensionCtor
  export default ext
}
declare module '@rey30-idvj/rag-extension' {
  const ext: BundledExtensionCtor
  export default ext
}
declare module '@rey30-idvj/vector-db-extension' {
  const ext: BundledExtensionCtor
  export default ext
}
declare module '@rey30-idvj/conversational-extension' {
  const ext: BundledExtensionCtor
  export default ext
}
