# Welcome to Remix development!

Remix is a framework for shipping better websites.

## Development

```
# install everything
yarn install

# run the build
yarn build

# run the tests
yarn test
# run the tests for a specific package
yarn test react
# run the tests in watch mode
yarn test react --watch

# cut a release
yarn run version major|minor|patch|prerelease [prereleaseId]
yarn run publish
# or, to automatically publish from GitHub Actions
git push origin --follow-tags
```