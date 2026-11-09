// @ts-check

/** @import {EMC} from './types/mount-observer/types' */;
/** @import {AllProps, Actions} from './types/be-pdfing/types' */
/** @import {RAConfig} from './types/roundabout/types' */

/**
 * @type {EMC<any, AllProps, Element, RAConfig<AllProps, Actions> >}
 */
export const emc = {
    matching: 'input[type="file"]',
    enhConfig: {
        enhKey: 'bePdfing',
        spawn: 'be-pdfing/be-pdfing.js',
        withAttrs: {
            base: 'be-pdfing',
            _base: {
                instanceOf: 'Object',
                mapsTo: '.'
            }
        }
    },
    customData: {
        weakRef: {
            properties: ['enhancedElement']
        },
        actions: {
            // Gated on `initialized` (set at the end of `init`), per the
            // Important Enhancement Addendum, so programmatic attachment works.
            hydrate: {
                ifKeyIn: ['initialized'],
                ifAllOf: ['enhancedElement', 'initialized']
            },
            // Re-runs when the rules change, without re-reading the file.
            structure: {
                ifKeyIn: ['extracted', 'rules'],
                ifAllOf: ['extracted']
            },
            storeResults: {
                ifAllOf: ['results', 'writeTo']
            }
        }
    }
}

export function render(){
    return JSON.stringify(emc, null, 4);
}

console.log(render());
