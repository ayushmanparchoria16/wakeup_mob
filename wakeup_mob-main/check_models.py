import urllib.request, json
try:
    url = "https://generativelanguage.googleapis.com/v1beta/models?key="
    resp = urllib.request.urlopen(url).read().decode()
    data = json.loads(resp)
    for m in data.get('models', []):
        print(m['name'])
except Exception as e:
    print(e)
