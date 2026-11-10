export function normalizeDigits(value){return String(value??'').replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)));}
export function configuredPassword(env){return typeof env.ADMIN_PASSWORD==='string'&&normalizeDigits(env.ADMIN_PASSWORD).length>=4;}
