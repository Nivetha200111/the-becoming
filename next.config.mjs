export default {
 outputFileTracingIncludes:{'/api/game':['./public/game/index.html']},
 async headers(){return [{source:'/(.*)',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'same-origin'}]}];},
};
