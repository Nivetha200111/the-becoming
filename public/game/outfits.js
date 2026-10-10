// Arena outfits change the silhouette as well as colour. The earned cloak palette stays yours.
export const OUTFITS = [
  { id: 'office', name: 'Office Day', arena: 'The Office', color: '#345e69', look: { top: '#eee4cf', sleeve: '#eee4cf', coat: '#345e69', legs: '#364851', boots: '#55463c', cloak: false, skirt: null } },
  { id: 'camp', name: 'Wayfarer', arena: 'Basecamp', color: '#547b68', look: { top: '#efe4c8', sleeve: '#efe4c8', skirt: '#efe4c8', legs: '#4a4843', cloak: true } },
  { id: 'forge', name: 'Forge Artisan', arena: 'Engineering Forge', color: '#9a6240', look: { top: '#ece3d0', sleeve: '#ece3d0', apron: '#9a6240', legs: '#343c43', boots: '#4a3326', cloak: false, skirt: null } },
  { id: 'citadel', name: 'Citadel Envoy', arena: 'Contract Citadel', color: '#365873', look: { top: '#365873', sleeve: '#365873', legs: '#253548', coat: '#365873', trim: '#d5b76e', cloak: false, skirt: null } },
  { id: 'grove', name: 'Grove Runner', arena: 'Recovery Grove', color: '#6e885c', look: { top: '#6e885c', sleeve: null, legs: '#c58c65', shorts: '#303f35', boots: '#eee6d7', athletic: true, cloak: false, skirt: null } },
  { id: 'tower', name: 'Lapis Scholar', arena: 'SPM Tower', color: '#495e91', look: { top: '#495e91', sleeve: '#495e91', skirt: '#495e91', legs: '#34374a', cloak: false, belt: '#dfc787', trim: '#dfc787' } },
  { id: 'temple', name: 'Temple Adept', arena: 'Claude Temple', color: '#886ba1', look: { top: '#886ba1', sleeve: '#886ba1', skirt: '#cbbada', legs: '#4c405a', cloak: false, belt: '#e4c774' } },
  { id: 'lab', name: 'Lab Inventor', arena: 'Automation Lab', color: '#eae8dc', look: { top: '#507b76', sleeve: '#f3f1e8', coat: '#f3f1e8', legs: '#3e484e', boots: '#655446', cloak: false, skirt: null } },
  { id: 'summit', name: 'Summit Scout', arena: 'Opportunity Summit', color: '#b1813f', look: { top: '#b1813f', sleeve: '#b1813f', legs: '#434637', boots: '#4b352b', cloak: false, skirt: null, coat: '#b1813f' } },
  { id: 'florentia', name: 'Florentine Painter', arena: 'Florentia', color: '#b3534b', look: { top: '#f1dfc5', sleeve: '#f1dfc5', skirt: '#b3534b', apron: '#e6cda7', cloak: false } },
  { id: 'skygarden', name: 'Cloud Wanderer', arena: 'Sky Gardens', color: '#a8ced3', look: { top: '#dcecf0', sleeve: '#dcecf0', skirt: '#a8ced3', legs: '#788c9a', boots: '#f0e9d9', cloak: false, trim: '#e8cc83' } },
  { id: 'bathhouse', name: 'Lantern Yukata', arena: 'Lantern Bathhouse', color: '#b06073', look: { top: '#b06073', sleeve: '#b06073', coat: '#b06073', skirt: '#b06073', legs: '#c58c65', boots: '#6d4835', belt: '#efe2b4', cloak: false } },
  { id: 'starfall', name: 'Starlight Keeper', arena: 'Starfall Shrine', color: '#526389', look: { top: '#526389', sleeve: '#526389', skirt: '#8690bb', legs: '#353e57', belt: '#9ed9ed', trim: '#9ed9ed', cloak: false } },
  { id: 'kobra', name: 'Kobra Kai Gi', arena: 'Kobra Kai', color: '#24221f', look: { top: '#24221f', sleeve: '#24221f', legs: '#24221f', boots: '#c58c65', belt: '#e3c35c', stripe: '#e3c35c', cloak: false, skirt: null } },
  { id: 'hollow', name: 'Hollow Weekend', arena: 'Hush Hollow', color: '#d49bb0', look: { top: '#d49bb0', sleeve: '#d49bb0', legs: '#eee4cc', boots: '#f5ede2', cloak: false, skirt: null } },
];
export function outfitLook(base, id) { return { ...base, ...(OUTFITS.find(o => o.id === id) || OUTFITS[0]).look }; }
