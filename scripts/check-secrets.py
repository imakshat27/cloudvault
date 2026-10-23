"""Scan tracked files without printing secret values. This is a guard, not proof of absence."""
import pathlib, re, subprocess, sys
patterns = [r'AKIA[0-9A-Z]{16}', r'ASIA[0-9A-Z]{16}', r'AIza[\w-]{30,}', r'gh[pousr]_[A-Za-z0-9]{30,}', r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----']
blocked = []
for filename in subprocess.check_output(['git','ls-files','-z']).decode().split('\0'):
 if not filename: continue
 p = pathlib.Path(filename)
 if not p.exists(): continue
 if p.suffix in ['.pem','.p12','.key'] or p.name == '.env' or (p.name.startswith('.env.') and p.name != '.env.example'): blocked.append(filename); continue
 if filename == 'scripts/check-secrets.py': continue
 try: text = p.read_text()
 except (UnicodeError, OSError): continue
 if any(re.search(pattern,text) for pattern in patterns): blocked.append(filename)
if blocked:
 print('Potential credentials detected in: ' + ', '.join(blocked)); sys.exit(1)
print('Secret scan passed for tracked files')
