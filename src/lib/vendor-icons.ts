// Vendor icon packs (AWS, Azure, Google Cloud, Kubernetes, tech + brand logos): downloaded on demand from jsDelivr (Kubernetes: raw.githubusercontent.com at a commit SHA, because jsDelivr refuses that repo as too large) at a PINNED
// version, integrity-checked (SHA-256 against values recorded below), sanitised, cached in IndexedDB for offline use and shown
// exactly as published (never recoloured or edited). Nothing here is part of the bundle.
//
// Integrity chain
//   iconify sets (gcp, logos, simple-icons): SHA-256 (hex) of the pinned icons.json, recorded in PACKS.sha256.
//   aws-icons: jsDelivr's flat file listing (path + SHA-256 per file) is hashed (canonical "path<TAB>hash" lines) and compared
//     with PACKS.sha256; every file is then verified against its listing hash.
//   kubernetes/community: per-file SHA-256 manifest recorded below (K8S_MANIFEST), pinned to a commit.
//   azure: no trustworthy on-demand source (Microsoft ships a ZIP): the owner imports the official ZIP, kept on this device.
// Supply-chain check (2026 npm incidents): pinned versions have no install scripts and no runtime dependencies besides
// @iconify/types; the packages hold only JSON/SVG data (+ iconify d.ts/js stubs, never executed here); the bytes jsDelivr serves
// equal the npm tarball (compared by SHA-256); nothing is executed and every SVG is sanitised before use.
import { useSyncExternalStore } from "react";

export type PackId = "aws" | "azure" | "gcp" | "k8s" | "logos" | "simple-icons";
export interface PackDef {
  id: PackId; name: string; group: string; source: "aws" | "iconify" | "k8s" | "zip";
  pkg: string; version: string; license: string; licenseUrl: string; termsUrl: string; termsLabel: string;
  /** Approximate download size in bytes (progress + label). */
  bytes: number; sha256?: string; blurb: string;
}
const CDN = "https://cdn.jsdelivr.net";
export const PACKS: PackDef[] = [
  { id: "aws", name: "AWS Architecture Icons", group: "Cloud", source: "aws", pkg: "aws-icons", version: "3.3.0", license: "AWS icon terms (npm packaging: MIT)", licenseUrl: "https://aws.amazon.com/architecture/icons/", termsUrl: "https://aws.amazon.com/architecture/icons/", termsLabel: "AWS terms", bytes: 1_100_000, sha256: "3188838991ab64d42025a04eca2892e7e395f4b9a0beb77b29a3bfc3f0cde56b", blurb: "Official AWS set (release 01/30/2026) via the aws-icons package." },
  { id: "azure", name: "Azure architecture icons", group: "Cloud", source: "zip", pkg: "", version: "official ZIP", license: "Microsoft terms", licenseUrl: "https://learn.microsoft.com/azure/architecture/icons/", termsUrl: "https://learn.microsoft.com/azure/architecture/icons/", termsLabel: "Azure terms", bytes: 0, blurb: "Import Microsoft's official ZIP (no trustworthy on-demand source). It stays on this device." },
  { id: "gcp", name: "Google Cloud icons", group: "Cloud", source: "iconify", pkg: "@iconify-json/gcp", version: "1.2.3", license: "Apache-2.0", licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0", termsUrl: "https://cloud.google.com/icons", termsLabel: "Google Cloud terms", bytes: 161_924, sha256: "7bb3cebf30a93085762e300ff7f327358523fcb23b65a39c789ce755f6a8b554", blurb: "Google Cloud product icons (Iconify gcp set)." },
  { id: "k8s", name: "Kubernetes community icons", group: "Cloud", source: "k8s", pkg: "kubernetes/community", version: "a620d469b204", license: "Apache-2.0 or CC-BY-4.0", licenseUrl: "https://github.com/kubernetes/community/blob/master/icons/README.md#license", termsUrl: "https://github.com/kubernetes/community/tree/master/icons", termsLabel: "Licence", bytes: 650_000, blurb: "kubernetes/community icon set, pinned to a commit." },
  { id: "logos", name: "Tech logos (Logos)", group: "Brands & tech", source: "iconify", pkg: "@iconify-json/logos", version: "1.2.20", license: "CC0-1.0 (trademarks stay with their owners)", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", termsUrl: "https://github.com/gilbarbara/logos", termsLabel: "Licence", bytes: 8_735_991, sha256: "f156f038114fe631ace10ec94f512dbd73436c24a18a7291ebdd9f0cfafc525c", blurb: "Full-colour brand and tech logos, grouped by category." },
  { id: "simple-icons", name: "Brand icons (Simple Icons)", group: "Brands & tech", source: "iconify", pkg: "@iconify-json/simple-icons", version: "1.2.103", license: "CC0-1.0 (trademarks stay with their owners)", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", termsUrl: "https://simpleicons.org", termsLabel: "Licence", bytes: 4_782_263, sha256: "fa72c7e8a048358e9fbce6776b28ea34b9fe881c20e0ea0cfe671b7b9348f891", blurb: "Single-colour brand marks, as published." },
];
export const getPack = (id: string) => PACKS.find((p) => p.id === id);
const K8S_SHA = "a620d469b204a55912856084eae1f92a299b4852";
const K8S_MANIFEST: Record<string, string> = {"control_plane_components/labeled/api.svg":"2hd9omTtDXfoJMCkQs+xnYm9qjfkC/kSXvL2zybCyjY=","control_plane_components/labeled/c-c-m.svg":"0ANBsAGjME44TyxYDPFa8fTQj3pFnVIU1aC30sX3qFU=","control_plane_components/labeled/c-m.svg":"C2Jodr/5Q6OMbfZrzYhM+/sLcVhRShvQXnZ7kCT9+ZE=","control_plane_components/labeled/k-proxy.svg":"RGYXYqt8i6S4R8Goe8MAexCjuNQIeVzCKIcdZMss7S4=","control_plane_components/labeled/kubelet.svg":"ZptABgCZeLihoIGyv3IqOX2NGqxvcXMVM7eq1bitp6E=","control_plane_components/labeled/sched.svg":"+0aHc1v0H8PPXocCgP8SvY4k8UlvA2VIoa9q1pa88q0=","infrastructure_components/labeled/ca.svg":"Pl9saWranNjUXO+6NzzvDyCDjCKrtomwOUtTfn9zpi4=","infrastructure_components/labeled/control-plane.svg":"lT445s9yIPUoWPfV4adfe3++uO3Ild/syUe7o0QE4/Y=","infrastructure_components/labeled/etcd.svg":"cwex0d5xb8WWUF1gxOJqFFNFvDRUjWle7XKCZrXJVDM=","infrastructure_components/labeled/node.svg":"FHkwHSznb7MIq59zbMQg0mvB89GEZDa8oY8J/aAI+mQ=","infrastructure_components/unlabeled/ca.svg":"RXxPmN//Jy0OcwfK0ERJErlkoWZ3K6lGzA9pySDbrlA=","infrastructure_components/unlabeled/control-plane.svg":"eBp2i8fG9vz3lum+vBBpL7q88/aAlFGR5s7cWBmsA+I=","infrastructure_components/unlabeled/etcd.svg":"1wD21Mo2BlaykTj+NCTq1tfonORvLrO5Mt+S5n43jQ4=","infrastructure_components/unlabeled/node.svg":"qZNnuKgF2bvJHvgs9HyKJD/k5t2P8s5DQvWXwsvsllo=","resources/labeled/c-role.svg":"gqyF2v8w+8CD6kIzCd6g/vV9nFFo+xaT1FOic6BUDNc=","resources/labeled/cm.svg":"gWeQpeJQqfURRqkoaQXdQHuiLbeKg5HUIssl+Iw6GHM=","resources/labeled/crb.svg":"FTjQOBoZB6E4cFc5IffJaNqmO1MsX0f2EHLjkM2SNDI=","resources/labeled/crd.svg":"EBfa9pcqSD67tjTDUGGTvetpaMIGUlDYzUGkjIW16xU=","resources/labeled/cronjob.svg":"qQZ3lLRUAFFLWQ8X6iXu1XXFD3Y8hCPWudsP8heavk0=","resources/labeled/deploy.svg":"z1dmZeoP4RzH8qsE8q8QF3iDww7lSSBCvqWN2BCsZZs=","resources/labeled/ds.svg":"RhTO3QTX22ay5YPz5w4aQ7cWqXf1a4RPjs6PWqhy30k=","resources/labeled/ep.svg":"foplbGNH7b4gJyF+A7hvLMofsJmZjDYivOWsdfoElJg=","resources/labeled/group.svg":"G1nE/yUnNVcN1iBVenRoSE72SyPLPxQ0h4Hy1NQQHfY=","resources/labeled/hpa.svg":"A7mr/vGM0VEmzt6YGnFkcUfCd/iuzmDuRJgmqpFCgT8=","resources/labeled/ing.svg":"tcf+JLeptuMfgxeh5BoExFV5s1ZpQcYbjcduco6b+Jo=","resources/labeled/job.svg":"PtCGX2WdyIFmtaZ4uTLQ7xBImHJQecdjRHFmxIXTBUo=","resources/labeled/limits.svg":"3WmCiZ4clCWz1d8YEBpCZKDrk2VAYloaLziI82PtPnE=","resources/labeled/netpol.svg":"U1PHxK/hBMprUuyHD5JxsT1rB0f+aqfBRbC/LI5bzRk=","resources/labeled/ns.svg":"Y3UspeDCBBP0K+yc9IGnJrVu4K2OXYkDhILP8lD52zU=","resources/labeled/pod.svg":"eisnm3NUKYTX7d1ZuHMfnMTLJkvjyzA+636twZb83TI=","resources/labeled/psp.svg":"zN5K28eZ08vctKLE9FVfd5oVMmxT02FcSg2qswi/h8s=","resources/labeled/pv.svg":"5nIY0TCshFdYplujzo5gMQ9ZoHrnkh9qT2laCNsJkkI=","resources/labeled/pvc.svg":"2n1tmfT/KVTP3ug45XIHXbSHUyfsjGFyZPry0XftqLY=","resources/labeled/quota.svg":"RfBMFtNUUkluZWMggg98sVz9/YLImw71xYPo/LckiNw=","resources/labeled/rb.svg":"XTsVvFIFGymt2gCs0vcrNMir8uLZXCqsX867rMOzGAs=","resources/labeled/role.svg":"Y7FIDjJS3KVDvOMmU9aqzRbeIpjf4kEuJod6YUSmjjo=","resources/labeled/rs.svg":"+s+i2WmBND5liEAESFeTznnzo4lX24ufHO+8rn9QPHg=","resources/labeled/sa.svg":"LzMeTmb3Pj9X4NQiNpqPhWHMSfgBDGMgXOcgqfO76sg=","resources/labeled/sc.svg":"wklOH+CaP8mQfk7AgPos0mwFycFMeqFW6mcN+CuaOkk=","resources/labeled/secret.svg":"Ol1+qAdIJ5t+MXfqS6A34wNHg0tDQxtK00d4z4f4qkA=","resources/labeled/sts.svg":"YQ3u5+521/rhS62TfzS54NTfRLaquRuOWm+fcY5gPoE=","resources/labeled/svc.svg":"IhgYC5Jvy9pFljxTBKRfergEM9zUpHoB5b+TX8FaZ3U=","resources/labeled/user.svg":"GRNJ9dOzJ2tUJhodIfl7j/hZHKQ9TvaaJougVUi2VpI=","resources/labeled/vol.svg":"oTQiX5rBrBke5ZIHmE10cHsWougSdC9UscoSfPWnr0I=","resources/labeled/vpa.svg":"qK6Wm51Kxp/Jzd7CKkK2Tcfsi4aa8g9ZE3uc28eR1mQ=","resources/unlabeled/c-role.svg":"08V10WthseyfTXxaBT0jqOJZeY3EeaN4O30q8XCcCo8=","resources/unlabeled/cm.svg":"ec2IG3F67VgNkKg/TGfH8sK1ZyomZp72HQ3dLaaqwq8=","resources/unlabeled/crb.svg":"Q8juhj/G06aQ/OIj9uFzvtP5iPFHNw1l4NFbHDdqr9Q=","resources/unlabeled/crd.svg":"CZxKL1VRNLnNsurS1dXCx42oRRbF8PfCsuiNfp/IJfQ=","resources/unlabeled/cronjob.svg":"fL0augv9NXDlEqsaDx9OzxHBFIu5aj442T+goO9R8mI=","resources/unlabeled/deploy.svg":"2W9uk6D1fKlYOyEg4920RTr7WimqbYwTYOjrjkWEifc=","resources/unlabeled/ds.svg":"Wss5fVtV9qTB+2dQp/9fqm+Eb02CtZ7AbwuA+uv80Z0=","resources/unlabeled/ep.svg":"mPborcOFnMYl7l6mfThYsF3UhB3YWDsZWhcckqa3m9Q=","resources/unlabeled/group.svg":"Yifw/CsL+72CaIKLFcV9sV5vqnbsswkjkOcMaprkPoo=","resources/unlabeled/hpa.svg":"e5KhGrYFCCWSe8kb9lRJmgLo+EiLBZ0leKsiA3kA++0=","resources/unlabeled/ing.svg":"Zqx1RC7/g+9RqNHvAe3YWMxiGw9D/2DiFw8dEMTUmBM=","resources/unlabeled/job.svg":"Hw8nP0JxsqWyLBQi2CGHV59UhhnIwDD54iJrzPs85n8=","resources/unlabeled/limits.svg":"X8a+szOzgMEaON3bapSgsYux1MdPCV3hSX3PZ8Bdlyg=","resources/unlabeled/netpol.svg":"mexKlgRwpsw4y3jrVx2Pbzn0FiLQPh/IXa3UpmCOnT0=","resources/unlabeled/ns.svg":"ZTniiMpvXOnIiu34UgMBYY0LHgEVeDSDEECWsMWorRk=","resources/unlabeled/pod.svg":"M1b3ypcPgR2isao0oPE+hGJVN4cngJq2Ypg3qELbCi0=","resources/unlabeled/psp.svg":"abH1ZCHEtKbDWFjiLnRl3ROMmfOPIq6uAvVv2KZFVIU=","resources/unlabeled/pv.svg":"k9bMyiJ8hjHqrJFvw3kR1cFuB2B8vUv7iCXilywirWY=","resources/unlabeled/pvc.svg":"G+ODliOUewxtMoNTjyE8J5M5jHINyPc5Q2Nx6WRiuyY=","resources/unlabeled/quota.svg":"EGplrDHpmKNTFuN6RqUx+qJHXTVGBDyTtBioZ/yPjdU=","resources/unlabeled/rb.svg":"aOm27A+Xcd3Kh9qyHfx8ZoZsGDf6YucD5Fogat+iH38=","resources/unlabeled/role.svg":"SzxEB+L/5/rIWZrqAuD0XHILqBpokcN/Fni6icdQSOY=","resources/unlabeled/rs.svg":"I0rczLUl78zHndmWvcGNc7WsV8dL647oVJcm9rK+tac=","resources/unlabeled/sa.svg":"/RE+aFxoQsB0+JFs3SQkJB/Kpk2r3c6C+a1g+bHZMoU=","resources/unlabeled/sc.svg":"gp9qJXVyJpq5fmlnrqvvdt2asj2Tz8xNX0PddUqBYsY=","resources/unlabeled/secret.svg":"FE+5ly1FbvFy/Ou+am19SSElTGWGsDgZYsmt0LNEaMI=","resources/unlabeled/sts.svg":"o15fr6DV1kLute2+RpJxbpWnYxiO8W0OwUdrfgguzic=","resources/unlabeled/svc.svg":"qG+tiBJTxNervnQTwO+8oufd5+VKVXdPeTSUlL2COZA=","resources/unlabeled/user.svg":"vnJ/WPke9hrr8bG9ok+47/8YvBBqn8Jg3f243BD1sl8=","resources/unlabeled/vol.svg":"B2JDSdRW0GTkEbOjcQNwvmSHVogIty4t/JfKXHj10CA=","resources/unlabeled/vpa.svg":"BchqmsxK/1W7IPPJQ5k2i4JBfyGWHeH5Kz8KEwHaCq4="};

// ------------------------------------------------------------------ sanitiser
const OK_EL = new Set("svg g path rect circle ellipse line polyline polygon defs lineargradient radialgradient stop clippath mask use symbol title desc pattern text tspan style filter fegaussianblur feoffset feblend fecolormatrix feflood fecomposite femerge femergenode femorphology fedropshadow".split(" "));
const OK_ATTR = /^(id|class|style|transform|viewbox|width|height|x|y|x1|x2|y1|y2|cx|cy|r|rx|ry|fx|fy|d|points|fill|fill-rule|fill-opacity|clip-rule|clip-path|clippathunits|stroke(-[a-z]+)?|opacity|offset|stop-color|stop-opacity|gradientunits|gradienttransform|spreadmethod|patternunits|patterntransform|patterncontentunits|maskunits|maskcontentunits|preserveaspectratio|xmlns|xmlns:xlink|version|href|xlink:href|mask|filter|color|display|visibility|vector-effect|marker-(start|mid|end)|font-[a-z-]+|text-anchor|text-rendering|dominant-baseline|letter-spacing|dx|dy|in|in2|result|stddeviation|mode|values|type|operator|k[1-4]|flood-color|flood-opacity|isolation|mix-blend-mode|shape-rendering|color-interpolation(-filters)?|data-name|xml:space|overflow|filterunits|primitiveunits|radius|rotate|textlength|lengthadjust|baseprofile)$/i;
const BAD_URL = /url\(\s*['"]?\s*(?!#)/i;
const BAD_CSS = /@import|expression\s*\(|javascript:|behavior\s*:|-moz-binding|<\/?script/i;
function cleanNode(el: Element): void {
  for (const a of Array.from(el.attributes)) {
    const n = a.name, v = a.value;
    const ok = OK_ATTR.test(n) && !/^on/i.test(n) && !BAD_URL.test(v) && !/javascript:|data:text\/html/i.test(v) && !(/href/i.test(n) && !v.trim().startsWith("#")) && !(n === "style" && BAD_CSS.test(v));
    if (!ok) el.removeAttribute(n);
  }
  for (const c of Array.from(el.children)) {
    const ln = c.localName.toLowerCase();
    if (!OK_EL.has(ln) || c.namespaceURI !== "http://www.w3.org/2000/svg" || (ln === "style" && (BAD_CSS.test(c.textContent ?? "") || BAD_URL.test(c.textContent ?? "")))) c.remove();
    else cleanNode(c);
  }
}
/** Strip scripts, event handlers, foreignObject, external references and unknown elements / attributes. Returns null if it is not a usable SVG. */
export function sanitizeSvg(svg: string): string | null {
  try {
    if (svg.length > 400_000) return null;
    const doc = new DOMParser().parseFromString(svg.replace(/<!DOCTYPE[^>]*>|<\?xml[^>]*\?>/gi, ""), "image/svg+xml");
    const root = doc.documentElement;
    if (!root || root.localName !== "svg" || doc.querySelector("parsererror")) return null;
    cleanNode(root);
    if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return new XMLSerializer().serializeToString(root);
  } catch { return null; }
}
const svgBox = (svg: string): { w: number; h: number } => {
  const vb = /viewBox="([\d.\s-]+)"/i.exec(svg)?.[1]?.trim().split(/\s+/).map(Number);
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { w: vb[2], h: vb[3] };
  const w = Number(/<svg[^>]*\swidth="([\d.]+)/i.exec(svg)?.[1]), h = Number(/<svg[^>]*\sheight="([\d.]+)/i.exec(svg)?.[1]);
  return w > 0 && h > 0 ? { w, h } : { w: 1, h: 1 };
};

// ------------------------------------------------------------------ naming / categories
const words = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/[-_]+/g, " ").trim();
const kebab = (s: string) => words(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const title = (s: string) => words(s).replace(/\b[a-z]/g, (c) => c.toUpperCase());
const CLOUD_CATS: [string, RegExp][] = [
  ["Containers", /container|kubernetes|eks|ecs|ecr|gke|anthos|fargate|docker|openshift|mesh|k8s/i],
  ["AI & ML", /sagemaker|rekognition|comprehend|lex|polly|textract|transcribe|translate|bedrock|forecast|personalize|\bai\b|\bml\b|machine|vertex|vision|speech|language|automl|nlp|q developer|kendra|deepracer|codewhisperer/i],
  ["Analytics", /athena|emr|kinesis|glue|quicksight|opensearch|elasticsearch|msk|analytic|lake|bigquery|dataflow|dataproc|pubsub|looker|data pipeline|datalab|dataprep|streaming|etl|warehouse|clean rooms/i],
  ["Database", /database|dynamo|rds|aurora|redshift|neptune|elasticache|documentdb|timestream|memorydb|keyspaces|spanner|bigtable|firestore|sql|datastore|memorystore|qldb|alloydb|cache/i],
  ["Storage", /s3|storage|ebs|efs|fsx|glacier|backup|bucket|filestore|disk|snow|datasync|archive/i],
  ["Networking", /vpc|route 53|cloudfront|cdn|api gateway|direct connect|network|load balanc|elb|transit|nat|vpn|dns|peering|interconnect|router|firewall|endpoint|gateway|subnet|internet/i],
  ["Security", /iam|security|cognito|kms|secret|shield|waf|guard|inspector|macie|certificate|identity|detective|key|trust|audit|compliance|armor|chronicle|encrypt/i],
  ["Integration", /sqs|sns|eventbridge|step functions|mq|appsync|appflow|workflow|queue|connector|integration|events|scheduler|express/i],
  ["Developer tools", /code|cloud9|x ray|developer|cli|sdk|amplify|build|deploy|pipeline|cdk|source|repo|debugger|shell|tools/i],
  ["Management", /cloudwatch|cloudtrail|config|systems manager|organizations|control tower|trusted advisor|monitor|logging|cloudformation|service catalog|health|billing|cost|license|console|operations|management|observability|ops/i],
  ["Compute", /ec2|lambda|compute|batch|beanstalk|lightsail|outposts|app engine|run|functions|instance|vm|gce|nitro|autoscal|workstations|bare metal|vmware|spot/i],
];
const cloudCat = (name: string): string => { for (const [c, r] of CLOUD_CATS) if (r.test(name)) return c; return "Other"; };
const BRANDS: [string, string[]][] = [
  ["Clouds & platforms", ["oracle", "ibm", "alibabacloud", "alibaba-cloud", "digitalocean", "cloudflare", "vercel", "netlify", "heroku", "firebase", "supabase", "google-cloud", "microsoft-azure", "amazon-aws", "linode", "ovh", "scaleway", "render", "railway", "fly"]],
  ["Data & AI", ["snowflake", "databricks", "mongodb", "postgresql", "mysql", "mariadb", "sqlite", "redis", "elasticsearch", "kafka", "apachekafka", "spark", "apache-spark", "apachespark", "openai", "anthropic", "huggingface", "pinecone", "clickhouse", "cassandra", "neo4j", "rabbitmq", "tensorflow", "pytorch", "pandas", "airflow", "apacheairflow", "dbt"]],
  ["DevOps", ["docker", "kubernetes", "terraform", "ansible", "github", "gitlab", "bitbucket", "jenkins", "prometheus", "grafana", "datadog", "nginx", "git", "argo", "helm", "circleci", "sentry", "newrelic", "opentelemetry", "traefik", "vault", "consul"]],
  ["SaaS & identity", ["stripe", "twilio", "salesforce", "slack", "auth0", "okta", "sendgrid", "shopify", "zendesk", "hubspot", "atlassian", "jira", "notion", "paypal", "zoom"]],
];
const brandCat = (id: string): string => {
  const base = id.replace(/-icon$|-wordmark$/, "");
  for (const [c, l] of BRANDS) if (l.includes(base)) return c;
  return "More logos";
};
const k8sCat = (p: string) => title(p.split("/")[0]);

// ------------------------------------------------------------------ storage (IndexedDB) + in-memory registry
export interface VIcon { id: string; name: string; cat: string; svg: string }
export interface PackMeta { version: string; count: number; bytes: number; ts: number }
interface Rec extends PackMeta { id: string; icons: VIcon[] }
const DBN = "lumen-vendor-icons";
const idb = (): Promise<IDBDatabase> => new Promise((res, rej) => { const r = indexedDB.open(DBN, 1); r.onupgradeneeded = () => r.result.createObjectStore("packs", { keyPath: "id" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((res, rej) => { const q = f(db.transaction("packs", mode).objectStore("packs")); q.onsuccess = () => { res(q.result); db.close(); }; q.onerror = () => { rej(q.error); db.close(); }; });
}
interface Loaded { meta: PackMeta; icons: VIcon[]; byId: Map<string, VIcon>; cats: string[] }
const mem = new Map<string, Loaded>();
export interface PackState { busy: boolean; pct: number; msg: string; error: string; meta?: PackMeta }
const state = new Map<string, Partial<PackState>>();
let snap = 0;
let cache: { v: number; s: Record<string, PackState> } = { v: -1, s: {} };
const subs = new Set<() => void>();
const bump = () => { snap++; subs.forEach((f) => f()); };
const setSt = (id: string, p: Partial<PackState>) => { state.set(id, { ...state.get(id), ...p }); bump(); };
const reg = (id: string, rec: Rec) => { const byId = new Map(rec.icons.map((i) => [i.id, i])); mem.set(id, { meta: { version: rec.version, count: rec.count, bytes: rec.bytes, ts: rec.ts }, icons: rec.icons, byId, cats: [...new Set(rec.icons.map((i) => i.cat))] }); };

let hydrated: Promise<void> | null = null;
/** Load every downloaded pack from IndexedDB into memory (once). Safe to call from anywhere; resolves when ready. */
export function initVendorIcons(): Promise<void> {
  hydrated ??= (async () => { try { const all = await tx<Rec[]>("readonly", (s) => s.getAll()); for (const r of all) reg(r.id, r); } catch { /* no IndexedDB */ } bump(); })();
  return hydrated;
}
/** Per-pack state (meta when downloaded, progress while busy, last error). Re-renders on any change. */
export function useVendorPacks(): Record<string, PackState> {
  void initVendorIcons();
  return useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => {
    if (cache.v !== snap) { const s: Record<string, PackState> = {}; for (const p of PACKS) s[p.id] = { busy: false, pct: 0, msg: "", error: "", ...state.get(p.id), meta: mem.get(p.id)?.meta }; cache = { v: snap, s }; }
    return cache.s;
  });
}
export const onVendorPacksChange = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const installedPacks = () => PACKS.filter((p) => mem.has(p.id));
export const packIcons = (id: string): VIcon[] => mem.get(id)?.icons ?? [];
export const packCategories = (id: string): string[] => mem.get(id)?.cats ?? [];

async function persist(def: PackDef, icons: VIcon[], bytes: number, version = def.version) {
  const rec: Rec = { id: def.id, version, count: icons.length, bytes, ts: Date.now(), icons };
  await tx("readwrite", (s) => s.put(rec));
  reg(def.id, rec);
  try { void navigator.storage?.persist?.(); } catch { /* ignore */ }
}
export async function removePack(id: string) {
  try { await tx("readwrite", (s) => s.delete(id)); } catch { /* ignore */ }
  mem.delete(id); state.delete(id); bump();
}

// ------------------------------------------------------------------ download + verify
const b64 = (b: ArrayBuffer) => { let s = ""; const u = new Uint8Array(b); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const sha = (d: Uint8Array) => crypto.subtle.digest("SHA-256", d as unknown as BufferSource);
async function fetchBytes(url: string, onBytes?: (n: number) => void): Promise<Uint8Array> {
  const r = await fetch(url, { cache: "force-cache" });
  if (!r.ok) throw new Error(`${r.status} ${url.split("/").slice(-1)[0]}`);
  if (!r.body || !onBytes) return new Uint8Array(await r.arrayBuffer());
  const rd = r.body.getReader(); const parts: Uint8Array[] = []; let n = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); n += value.length; onBytes(n); }
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const dec = (u: Uint8Array) => new TextDecoder().decode(u);
async function pool<T>(items: T[], n: number, f: (x: T) => Promise<void>) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await f(items[i++]); })); }
const tick = () => new Promise((r) => setTimeout(r, 0));
type Prog = (p: number, m: string) => void;

async function dlIconify(def: PackDef, prog: Prog) {
  const raw = await fetchBytes(`${CDN}/npm/${def.pkg}@${def.version}/icons.json`, (n) => prog(Math.min(0.7, (n / def.bytes) * 0.7), "Downloading"));
  prog(0.7, "Verifying SHA-256");
  if (hex(await sha(raw)) !== def.sha256) throw new Error("Integrity check failed (SHA-256 mismatch). Nothing was stored.");
  const j = JSON.parse(dec(raw)) as { width?: number; height?: number; icons: Record<string, { body: string; width?: number; height?: number }> };
  const W = j.width ?? 16, H = j.height ?? 16, out: VIcon[] = [];
  const names = Object.keys(j.icons);
  for (let i = 0; i < names.length; i++) {
    const id = names[i], ic = j.icons[id];
    const s = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ic.width ?? W} ${ic.height ?? H}">${ic.body}</svg>`);
    if (s) out.push({ id, name: title(id.replace(/-icon$/, "")), cat: def.id === "gcp" ? cloudCat(words(id)) : !id.endsWith("-icon") && j.icons[id + "-icon"] ? "More logos" : brandCat(id), svg: s });
    if (i % 250 === 0) { prog(0.7 + (i / names.length) * 0.28, "Preparing icons"); await tick(); }
  }
  return { icons: out, bytes: raw.length };
}
async function dlAws(def: PackDef, prog: Prog) {
  const lr = await fetch(`https://data.jsdelivr.com/v1/packages/npm/${def.pkg}@${def.version}?structure=flat`);
  if (!lr.ok) throw new Error("Could not list the pack");
  const files = ((await lr.json()) as { files: { name: string; hash: string }[] }).files.filter((f) => f.name.startsWith("/icons/") && f.name.endsWith(".svg")).sort((a, b) => (a.name < b.name ? -1 : 1));
  if (hex(await sha(new TextEncoder().encode(files.map((f) => f.name + "\t" + f.hash).join("\n")))) !== def.sha256) throw new Error("Integrity check failed (file listing differs from the pinned release). Nothing was stored.");
  const out: VIcon[] = []; let bytes = 0, done = 0;
  await pool(files, 32, async (f) => {
    const u = await fetchBytes(`${CDN}/npm/${def.pkg}@${def.version}${f.name}`);
    if (b64(await sha(u)) !== f.hash) throw new Error(`Integrity check failed for ${f.name.split("/").pop()}`);
    bytes += u.length;
    const [, , dir, file] = f.name.split("/");
    const base = file.replace(/\.svg$/, "");
    const s = sanitizeSvg(dec(u));
    done++; if (done % 25 === 0) prog(done / files.length, "Downloading");
    if (!s) return;
    const cat = dir === "architecture-service" ? cloudCat(words(base)) : dir === "architecture-group" ? "Groups" : dir === "category" ? "Categories" : "Resources";
    const sfx = ({ "architecture-service": "", "architecture-group": "-group", category: "-category", resource: "-resource" } as Record<string, string>)[dir] ?? "";
    out.push({ id: kebab(base) + sfx, name: title(base), cat, svg: s });
  });
  out.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { icons: out, bytes };
}
async function dlK8s(def: PackDef, prog: Prog) {
  const paths = Object.keys(K8S_MANIFEST); const out: VIcon[] = []; let bytes = 0, done = 0;
  await pool(paths, 12, async (p) => {
    const u = await fetchBytes(`https://raw.githubusercontent.com/kubernetes/community/${K8S_SHA}/icons/svg/${p}`);
    if (b64(await sha(u)) !== K8S_MANIFEST[p]) throw new Error(`Integrity check failed for ${p}`);
    bytes += u.length; done++; prog(done / paths.length, "Downloading");
    const s = sanitizeSvg(dec(u)); if (!s) return;
    const parts = p.replace(/\.svg$/, "").split("/"); const plain = parts.includes("unlabeled");
    out.push({ id: kebab(parts.filter((x) => x !== "labeled" && x !== "unlabeled").join("-")) + (plain ? "-plain" : ""), name: title(parts[parts.length - 1]) + (plain ? " (no label)" : ""), cat: k8sCat(p), svg: s });
  });
  out.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { icons: out, bytes };
}
/** Download, verify, sanitise and cache a pack. Progress and errors are reflected in useVendorPacks(). */
export async function downloadPack(id: string): Promise<boolean> {
  const def = getPack(id); if (!def || def.source === "zip" || state.get(id)?.busy) return false;
  setSt(id, { busy: true, pct: 0, msg: "Starting", error: "" });
  const prog: Prog = (p, m) => setSt(id, { pct: Math.round(p * 100), msg: m });
  try {
    const r = def.source === "aws" ? await dlAws(def, prog) : def.source === "k8s" ? await dlK8s(def, prog) : await dlIconify(def, prog);
    if (!r.icons.length) throw new Error("The pack had no usable icons");
    prog(0.99, "Saving for offline use");
    await persist(def, r.icons, r.bytes);
    setSt(id, { busy: false, pct: 100, msg: "", error: "" });
    return true;
  } catch (e) { setSt(id, { busy: false, pct: 0, msg: "", error: e instanceof Error ? e.message : "Download failed" }); return false; }
}

// ---- Azure: the owner imports Microsoft's official ZIP (parsed in the browser; stays on this device)
async function unzip(buf: ArrayBuffer): Promise<{ name: string; data: Uint8Array }[]> {
  const v = new DataView(buf), u = new Uint8Array(buf); let e = u.length - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("Not a ZIP file");
  const n = v.getUint16(e + 10, true); let p = v.getUint32(e + 16, true); const out: { name: string; data: Uint8Array }[] = [];
  for (let i = 0; i < n; i++) {
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    const name = dec(u.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    if (!/\.svg$/i.test(name) || /__MACOSX/.test(name)) continue;
    const lo = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true), raw = u.subarray(lo, lo + csize);
    if (method === 0) out.push({ name, data: raw });
    else if (method === 8) out.push({ name, data: new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()) });
  }
  return out;
}
/** Import the official Azure icons ZIP (or loose .svg files). Categories follow the ZIP's folders. Returns the icon count. */
export async function importAzureFiles(files: File[]): Promise<number> {
  const def = getPack("azure")!; setSt("azure", { busy: true, pct: 5, msg: "Reading", error: "" });
  try {
    const raw: { name: string; data: Uint8Array }[] = [];
    for (const f of files) { if (/\.zip$/i.test(f.name)) raw.push(...(await unzip(await f.arrayBuffer()))); else if (/\.svg$/i.test(f.name)) raw.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }); }
    const out: VIcon[] = []; const seen = new Set<string>(); let bytes = 0;
    for (const r of raw) {
      const s = sanitizeSvg(dec(r.data)); if (!s) continue;
      const parts = r.name.split("/"); const file = parts[parts.length - 1].replace(/\.svg$/i, "").replace(/^\d+-icon-service-/i, "");
      let id = kebab(file); if (seen.has(id)) id += "-" + out.length; seen.add(id); bytes += r.data.length;
      out.push({ id, name: title(file), cat: parts.length > 1 ? title(parts[parts.length - 2]) : "Icons", svg: s });
    }
    if (!out.length) throw new Error("No .svg files found in that selection");
    out.sort((a, b) => (a.id < b.id ? -1 : 1));
    await persist(def, out, bytes, "imported ZIP");
    setSt("azure", { busy: false, pct: 100, msg: "", error: "" });
    return out.length;
  } catch (e) { setSt("azure", { busy: false, pct: 0, msg: "", error: e instanceof Error ? e.message : "Import failed" }); return 0; }
}

// ------------------------------------------------------------------ lookup, search, rendering helpers
export const vendorRef = (pack: string, id: string) => `vendor:${pack}/${id}`;
export function parseVendorRef(ref: string): { pack: string; id: string } | null {
  const m = /^vendor:([a-z0-9-]+)\/(.+)$/.exec(ref); return m ? { pack: m[1], id: m[2] } : null;
}
export interface VendorHit { ref: string; pack: string; id: string; name: string; cat: string; svg: string }
export function getVendorIcon(ref: string): VendorHit | undefined {
  const p = parseVendorRef(ref); const i = p && mem.get(p.pack)?.byId.get(p.id);
  return p && i ? { ref, pack: p.pack, id: i.id, name: i.name, cat: i.cat, svg: i.svg } : undefined;
}
const dataUrl = (svg: string) => "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
/** Sanitised SVG text for an icon ref (null if the pack is not downloaded / the icon is unknown). Sanitised again on every call. */
export const vendorIconSvg = (ref: string): string | null => { const h = getVendorIcon(ref); return h ? sanitizeSvg(h.svg) : null; };
/** Data URL for <img src>, or undefined until the cache is hydrated / when the pack is missing. */
export const vendorIconUrl = (ref: string): string | undefined => { const s = vendorIconSvg(ref); return s ? dataUrl(s) : undefined; };
/** React hook for the studio / canvas renderer: `<img src={useVendorIconUrl(node.lumenNode.icon)} />`. Re-renders once packs are hydrated or change. */
export function useVendorIconUrl(icon: string | undefined): string | undefined {
  useVendorPacks();
  return icon && icon.startsWith("vendor:") ? vendorIconUrl(icon) : undefined;
}
export const isVendorRef = (s: unknown): s is string => typeof s === "string" && s.startsWith("vendor:");
/** Width / height ratio of an icon (for the inserted image element). */
export const vendorAspect = (svg: string) => { const b = svgBox(svg); return b.w / b.h; };

/** Search every downloaded pack (name, id, category). */
export function searchVendorIcons(q: string, limit = 80): VendorHit[] {
  const s = q.trim().toLowerCase(); if (!s) return [];
  const out: VendorHit[] = [];
  for (const [pack, l] of mem) for (const i of l.icons) {
    if (i.name.toLowerCase().includes(s) || i.id.includes(s) || i.cat.toLowerCase().includes(s)) { out.push({ ref: vendorRef(pack, i.id), pack, id: i.id, name: i.name, cat: i.cat, svg: i.svg }); if (out.length >= limit) return out; }
  }
  return out;
}

// ------------------------------------------------------------------ Mermaid architecture-beta
interface IconifySet { prefix: string; width: number; height: number; icons: Record<string, { body: string; width?: number; height?: number }> }
function toIconify(pack: string): IconifySet {
  const icons: IconifySet["icons"] = {};
  for (const i of packIcons(pack)) {
    const body = /^<svg[^>]*>([\s\S]*)<\/svg>$/.exec(i.svg)?.[1]; if (body == null) continue;
    const b = svgBox(i.svg); icons[i.id] = { body, width: b.w, height: b.h };
  }
  return { prefix: pack, width: 24, height: 24, icons };
}
/** Register every downloaded pack with Mermaid so architecture-beta can use aws:ec2, logos:docker-icon, gcp:..., k8s:..., simple-icons:..., azure:...
 *  Call after mermaid.initialize (and again after a pack is downloaded or removed). Pass the mermaid default export; omit to import it. */
export async function registerVendorIconPacks(mermaid?: { registerIconPacks: (p: never) => void }): Promise<string[]> {
  await initVendorIcons();
  const names = installedPacks().map((p) => p.id);
  if (!names.length) return [];
  const m = mermaid ?? (await import("mermaid")).default;
  m.registerIconPacks(names.map((n) => ({ name: n, loader: async () => toIconify(n) })) as never);
  return names;
}
