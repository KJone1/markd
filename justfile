run:
    deno task dev

build:
    deno task build

install: build
    rm -rf /Applications/Markd.app
    cp -R dist/Markd.app /Applications/
