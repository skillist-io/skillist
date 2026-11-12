#!/bin/bash
# Prints PASS or FAIL per check, and exits 1 if anything that should be blocked got out.
# A 520 is the sandbox egress policy refusing a request. Each check uses a harmless GET.
failures=0
code() { curl -s -o /dev/null -m 15 -w '%{http_code}' "$@"; }
check() {
  local name=$1 expected=$2 actual=$3
  if [[ "$actual" == $expected ]]; then echo "PASS $name ($actual)"; else echo "FAIL $name: expected $expected, got $actual"; failures=$((failures + 1)); fi
}

check "allowed host over HTTPS" "200" "$(code https://github.com/)"
check "Node.js trusts the intercept" "200" "$(node -e "fetch('https://github.com/').then(r=>console.log(r.status),()=>console.log('error'))")"
check "blocked host over HTTPS" "520" "$(code https://example.com/)"
check "blocked host over HTTP" "520" "$(code http://example.com/)"
check "lookalike host" "520" "$(code https://github.com.example.com/)"
check "allowed address, blocked Host header" "520" "$(code -H 'Host: example.com' https://github.com/)"
check "cloud metadata address" "520" "$(code http://169.254.169.254/)"
check "raw IP over HTTP" "520" "$(code http://1.1.1.1/)"
check "raw IP over HTTPS" "000" "$(code https://1.1.1.1/)"
check "non-HTTP port" "000" "$(code http://example.com:8080/)"
check "redirect to a blocked host" "520" "$(curl -s -L -o /dev/null -m 20 -w '%{http_code}' 'https://httpbin.org/redirect-to?url=https%3A%2F%2Fexample.com%2F')"

# Raw TCP may connect to the proxy, but no bytes may come back.
raw=$(python3 -c "
import socket
s=socket.socket(); s.settimeout(6)
try:
    s.connect(('1.1.1.1',4444)); s.sendall(b'hi'); print(len(s.recv(64)))
except Exception:
    print(0)")
check "raw TCP returns no data" "0" "$raw"

echo "$failures failed"
exit $((failures > 0))
