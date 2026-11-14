import type {InteriorStyle} from '../lib/interior';
export type Finish = 'Gloss' | 'Matte' | 'Satin' | 'Metallic' | 'Pearl' | 'Chrome';
export interface Product { name:string; hex:string; code:string; available:boolean; finishes:Finish[]; brand?:string; texture?:string }
export const finishes:Finish[]=['Gloss','Matte','Satin','Metallic','Pearl','Chrome'];
const palette=[['Pearl White','#F4F4F2'],['Silver','#B8BDC3'],['Graphite Grey','#44484D'],['Jet Black','#090A0C'],['Electric Blue','#0066B7'],['Midnight Blue','#173B70'],['Racing Red','#D52236'],['Forest Green','#1E592C'],['Sunset Orange','#FF7900'],['Golden Yellow','#FFD347'],['Royal Purple','#75509A'],['Champagne Beige','#D8C6AC']];
export const products:Product[]=palette.map(([name,hex],i)=>({name,hex,code:`DS-${String(i+1).padStart(3,'0')}`,available:true,finishes}));
export const customProduct=(hex:string):Product=>({name:'Custom color',hex,code:'DS-CUSTOM',available:true,finishes});

/** A selectable color for a vehicle part, with optional physical surface values. */
export interface Swatch { name:string; hex:string; metalness?:number; roughness?:number }
export const rimOptions:Swatch[]=[
 {name:'Silver',hex:'#C3C7CC',metalness:1,roughness:.24},
 {name:'Gunmetal',hex:'#3B3E43',metalness:.9,roughness:.32},
 {name:'Gloss Black',hex:'#0B0B0C',metalness:.25,roughness:.12},
 {name:'Satin Bronze',hex:'#8A6A3E',metalness:1,roughness:.34},
 {name:'Gold',hex:'#C9A64A',metalness:1,roughness:.22},
 {name:'White',hex:'#EDEDED',metalness:.05,roughness:.3},
 {name:'Chrome',hex:'#F4F4F4',metalness:1,roughness:.04}
];
export const caliperOptions:Swatch[]=[
 {name:'Graphite',hex:'#2A2B2E',metalness:.3,roughness:.4},
 {name:'Racing Red',hex:'#C4161C',metalness:.1,roughness:.25},
 {name:'Yellow',hex:'#F2C200',metalness:.1,roughness:.25},
 {name:'Blue',hex:'#1F5FD6',metalness:.1,roughness:.25},
 {name:'Orange',hex:'#FF7900',metalness:.1,roughness:.25},
 {name:'Green',hex:'#2F8F3A',metalness:.1,roughness:.25}
];
export const interiorOptions:Swatch[]=[
 {name:'Black',hex:'#141414',roughness:.55},
 {name:'Cognac',hex:'#6B3419',roughness:.5},
 {name:'Ivory',hex:'#D9CDB4',roughness:.55},
 {name:'Coffee',hex:'#3D2A20',roughness:.55},
 {name:'Red',hex:'#7D1015',roughness:.5},
 {name:'Ocean Blue',hex:'#1D2B44',roughness:.55},
 {name:'Slate Grey',hex:'#5E6166',roughness:.55}
];
export const ambientOptions:Swatch[]=[
 {name:'Off',hex:'#000000'},
 {name:'Warm White',hex:'#FFD3A1'},
 {name:'Ice Blue',hex:'#7FCBFF'},
 {name:'Studio Orange',hex:'#FF7900'},
 {name:'Magenta',hex:'#FF3D9A'},
 {name:'Violet',hex:'#8F5BFF'},
 {name:'Mint',hex:'#39F2A0'}
];

/** Everything the customer can change on the car. */
export interface Look { paint:string; finish:Finish; rim:string; caliper:string; interior:string; ambient:string; tint:number; lights:boolean; /** Node names of the doors, hood, trunk etc. that are open. */ open:string[]; /** Rim design name, 'Original' keeps the model's rims. */ rimDesign:string; /** Enabled carbon fibre zones. */ carbon:string[]; /** Dash and door inlay (cars with a generated interior). */ inlay:string }
export const defaultLook:Look={paint:products[0].hex,finish:'Gloss',rim:'Silver',caliper:'Graphite',interior:'Cognac',ambient:'Warm White',tint:.35,lights:false,open:[],rimDesign:'Original',carbon:[],inlay:'Fineline Wood'};
export const carbonOptions=['Roof','Hood','Rear deck','Lower kit','Full body'];

/** Selects meshes by material name and/or by mesh-name prefix. Both must match when both are given. */
export interface PartSpec { materials?:string[]; meshes?:string[]; /** Exact names of a node or any of its ancestors. */ nodes?:string[] }
export interface CabinSeat { label:string; eye:[number,number,number] }
/** A hinged part. The sign of `angle` is corrected automatically so the part always swings outward. */
export interface Opening { node:string; label:string; axis:'x'|'y'|'z'; angle:number }
export interface Vehicle {
 id:string;brand:string;model:string;year:number;available:boolean;asset:string;length:number;rotation:number;paintMaterials:string[];attribution:string;source:string;
 /** Customizable parts. Missing parts are disabled in the UI. */
 parts?:{rims?:PartSpec;calipers?:PartSpec;interior?:PartSpec;glass?:PartSpec;headlights?:PartSpec;taillights?:PartSpec};
 /** Interior camera: seat eye points and the forward direction, in normalized vehicle meters. */
 cabin?:{forward:[number,number,number];seats:CabinSeat[];light:[number,number,number]};
 /** Hinged parts (doors, hood, tailgate) that can be opened. */
 openings?:Opening[];
 /** Meshes whose symmetric half is missing from the source file; mirrored across the centerline on load. */
 mirror?:{meshes:string[];axis:'x'|'z'};
 /** Nodes removed on load (baked shadow planes, stray helpers) before the car is measured and scaled. */
 hide?:string[];
 /** The rim material also covers the tyre (one combined wheel mesh): custom rims then bring their own tyre. */
 wheels?:{replaceTires?:boolean};
 /** Generated interior materials and displays for a cabin that has geometry but no textures. */
 interiorStyle?:InteriorStyle;
 /** Extra Y offset (m) for the exterior camera focus, for low or tall cars. */
 focusHeight?:number;
}
