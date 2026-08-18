run:
    deno task dev

check:
    deno task check

build:
    deno task build

install: build
    rm -rf /Applications/Markd.app
    cp -R dist/Markd.app /Applications/
    mkdir -p ~/.local/bin
    install -m 755 bin/markd ~/.local/bin/markd
