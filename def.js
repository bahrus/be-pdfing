import 'assign-gingerly/object-extension.js';

/**
 * Registers be-pdfing's config with the enhancement registry, so it can be
 * attached programmatically via `enh.set.bePdfing` or `enh.get(emc)`.
 * @param {Element | undefined} ref
 */
export async function defBePdfing(ref){
    const {default: emc} = await import('./emc.json', {with: {type: 'json'}});
    return await push(ref, emc);
}

async function push(ref, emc){
    const {BePdfing} = await import('./be-pdfing.js');
    const {enhConfig} = emc;
    enhConfig.spawn = BePdfing;
    enhConfig.customData = emc.customData;
    const registry = ref?.customElementRegistry ?? customElements;
    const {enhancementRegistry} = registry;
    enhancementRegistry.push(enhConfig);
    return enhConfig;
}
