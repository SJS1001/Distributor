#!/usr/bin/env python3
"""Import public GREE Canada catalogue without prices, purchase SKUs or credentials.
Run: python3 scripts/import-gree-catalog.py [--cache-dir /tmp/gree-catalog-cache]
The optional cache retains public responses for repeatable parsing/offline review.
"""
import argparse, concurrent.futures, datetime, hashlib, html, json, pathlib, re, urllib.request
from html.parser import HTMLParser
from urllib.parse import urljoin

BASE = 'https://www.gree.ca'
ROOT = pathlib.Path(__file__).resolve().parents[1]
CATEGORY_HANDLES = ['mini-splits', 'multi-zone-mini-splits', 'indoor-units-all-match-r32', 'indoor-units-free-match', 'ducted-central-heat-pump', 'rtu', 'mini-gmv', 'indoor-units-vrf', 'air-to-water', 'ptacs-and-ttws', 'window-air-conditioner', 'mobile-air-conditioner', 'dehumidifier']

class Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts=[]; self.skip=0
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style'): self.skip+=1
        elif tag in ('p','br','li','h2','h3','h4','h5','div'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script','style'): self.skip=max(0,self.skip-1)
        elif tag in ('p','li','div'): self.parts.append('\n')
    def handle_data(self, data):
        if not self.skip: self.parts.append(data)

def plain(markup):
    p=Text(); p.feed(markup)
    return '\n'.join(x.strip() for x in ''.join(p.parts).splitlines() if x.strip())

def documents(markup):
    docs=[]
    for url, title in re.findall(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', markup, re.S|re.I):
        url=html.unescape(url)
        if not re.search(r'\.(pdf|xlsx?|docx?|zip)(?:[?#]|$)', url, re.I): continue
        title=plain(title) or urllib.parse.unquote(url.split('/')[-1].split('?')[0])
        kind=('Brochure' if re.search('brochure',title,re.I) else 'Submittal' if re.search('submittal',title,re.I) else 'Manual' if re.search('manual',title,re.I) else 'Technical document')
        doc={'title':title,'url':urljoin(BASE,url),'kind':kind}
        if doc not in docs: docs.append(doc)
    return docs

def specs(markup):
    prefix=re.search(r'class=["\'][^"\']*MetafieldsGuru-Block__Prefix[^"\']*["\'][^>]*>(.*?)</div>',markup,re.S)
    content=re.search(r'class=["\'][^"\']*MetafieldsGuru-Block__Content[^"\']*["\'][^>]*>(.*?)</div>',markup,re.S)
    if prefix and content:
        label,value=plain(prefix[1]),plain(content[1])
        suffix=re.search(r'class=["\'][^"\']*MetafieldsGuru-Block__Suffix[^"\']*["\'][^>]*>(.*?)</div>',markup,re.S)
        if suffix and plain(suffix[1]): value += ' ' + plain(suffix[1])
        if label and value: return {'label':label,'value':value}
    return None

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--verify-documents',action='store_true');parser.add_argument('--refresh',action='store_true');parser.add_argument('--cache-dir',type=pathlib.Path,default=pathlib.Path('/tmp/gree-catalog-cache'));args=parser.parse_args();args.cache_dir.mkdir(parents=True,exist_ok=True)
    sources={}
    def fetch(url):
        path=args.cache_dir/(hashlib.sha256(url.encode()).hexdigest()+'.txt')
        if path.exists() and not args.refresh: raw=path.read_bytes()
        else:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Distributor catalogue importer; public product reference'}),timeout=60) as r: raw=r.read()
            path.write_bytes(raw)
        sources[url]={'url':url,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
        return raw.decode('utf-8')
    products=[]; page=1
    while True:
        batch=json.loads(fetch(f'{BASE}/products.json?limit=250&page={page}'))['products']
        if not batch: break
        products.extend(batch);page+=1
    collections=json.loads(fetch(f'{BASE}/collections.json?limit=250'))['collections']
    def collection(c):
        members=[];page=1
        while True:
            batch=json.loads(fetch(f'{BASE}/collections/{c["handle"]}/products.json?limit=250&page={page}'))['products']
            if not batch: break
            members.extend(str(p['id']) for p in batch);page+=1
        return {'id':c['handle'],'title':c['title'],'sourceUrl':f'{BASE}/collections/{c["handle"]}','productIds':members}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: all_collections=list(pool.map(collection,collections))
    membership={str(p['id']):[c['id'] for c in all_collections if str(p['id']) in c['productIds']] for p in products}
    categories=[next(c for c in all_collections if c['id']==h) for h in CATEGORY_HANDLES]
    def product(p):
        source=f'{BASE}/products/{p["handle"]}'; markup=fetch(source); product_docs=documents(markup)
        variants={str(v['id']):{'id':str(v['id']),'title':v['title'],'manufacturerModel':v.get('sku') or None,'options':[v.get('option1'),v.get('option2'),v.get('option3')],'specifications':[],'documents':[]} for v in p['variants']}
        for data in re.findall(r'<script\b[^>]*data-mg-product-variant-json[^>]*>(.*?)</script>',markup,re.S):
            for vid, block in json.loads(data).get('variants',{}).items():
                if vid not in variants or not block: continue
                spec=specs(block)
                if spec and spec not in variants[vid]['specifications']: variants[vid]['specifications'].append(spec)
                for doc in documents(block):
                    if doc not in variants[vid]['documents']: variants[vid]['documents'].append(doc)
                    if doc not in product_docs: product_docs.append(doc)
        primary=next((c for c in categories if str(p['id']) in c['productIds']),None)
        return {'id':str(p['id']),'handle':p['handle'],'title':p['title'],'category':primary['title'] if primary else p['product_type'],'categoryId':primary['id'] if primary else 'other','categories':membership[str(p['id'])],'productType':p['product_type'],'description':plain(p['body_html']),'images':[{'url':i['src'],'alt':i.get('alt') or p['title']} for i in p['images']],'documents':product_docs,'sourceUrl':source,'specifications':next((v['specifications'] for v in variants.values() if v['specifications']),[]),'models':list(variants.values()),'historical': 'old-product' in membership[str(p['id'])]}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: result=list(pool.map(product,products))
    technical=fetch(f'{BASE}/pages/professionnal-documents')
    retrieved=datetime.datetime.now(datetime.timezone.utc).isoformat()
    data={'retrievedOn':retrieved,'sourceUrl':BASE,'categories':categories,'products':result}
    out=ROOT/'src/web/gree-catalog-data.json';out.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    preview_products=[next(p for p in result if p['handle']==h) for h in ['unix-eco','clivia-r32','crossover-series','vita-series','extreme-series']]
    preview_categories=[next(c for c in categories if c['id']==h) for h in ['mini-splits','ducted-central-heat-pump','multi-zone-mini-splits','rtu']]
    preview={'productCount':len(result),'documentCount':len({d['url'] for p in result for d in p['documents']}),'products':[{'id':p['id'],'title':p['title'],'category':p['category'],'imageUrl':p['images'][0]['url'],'categoryId':p['categoryId']} for p in preview_products],'categories':[]}
    for c in preview_categories:
        p=next(p for p in result if p['id'] in c['productIds'])
        preview['categories'].append({'id':c['id'],'title':c['title'],'productId':p['id'],'imageUrl':p['images'][0]['url'],'count':len(c['productIds'])})
    (ROOT/'src/web/gree-catalog-preview.json').write_text(json.dumps(preview,ensure_ascii=False,indent=2)+'\n')
    manifest={'retrievedOn' :retrieved,'status':'Official public catalogue reference; not purchasing inventory','rights':'Owner explicitly authorized reuse of Gree product information, images and documents on 2026-10-05. No broader third-party reuse licence asserted.','productCount':len(result),'variantCount':sum(len(p['models']) for p in result),'imageCount':sum(len(p['images']) for p in result),'documentAssociations':sum(len(p['documents']) for p in result),'uniqueDocumentCount':len({d['url'] for p in result for d in p['documents']}),'collections':all_collections,'sources':sorted(sources.values(),key=lambda x:x['url']),'gaps':['Professional technical document page is access-controlled for unauthenticated requests; no authentication bypass attempted. Public product-page and variant document links are included.','Published CDN document links are indexed; only sampled HTTP responses checked separately. Binary manuals were not mirrored or content/model/revision qualified.','This is all public Shopify product pages at retrieval, including older collections. Prices, stock, availability and purchase SKUs are intentionally not imported.','Product specifications at top level describe the first source variant; models retain each source variant specification and document association.'],'productsWithoutDescriptions':[p['handle'] for p in result if not p['description']],'productsWithoutDocuments':[p['handle'] for p in result if not p['documents']],'productsWithoutSpecifications':[p['handle'] for p in result if not p['specifications']]}
    if args.verify_documents:
        def verify(url):
            try:
                with urllib.request.urlopen(urllib.request.Request(url,method='HEAD'),timeout=30) as response:
                    return {'url':url,'status':response.status,'contentType':response.headers.get('Content-Type'),'bytes':response.headers.get('Content-Length')}
            except Exception as error: return {'url':url,'error':str(error)}
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            manifest['documentHttpChecks']=list(pool.map(verify,sorted({d['url'] for p in result for d in p['documents']})))
        manifest['gaps'][1]='All unique published document URLs were HTTP HEAD checked; results retained. Binary manuals were not mirrored or content/model/revision qualified.'
    (ROOT/'docs/catalog/gree-ca-source-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:manifest[k] for k in ('productCount','variantCount','imageCount','documentAssociations','uniqueDocumentCount','productsWithoutDocuments','productsWithoutSpecifications')},indent=2))
if __name__=='__main__':main()
