//go:build !windows

package main

// 2.4.6: not Windows (the tests): the install's first-start ask as files in Home (pairopen.go; on Windows the install's
// record in the registry, pairstore_windows.go)

import (
	"errors"
	"os"
	"path/filepath"
)

const (
	pairOpenDueName = "pair-open-due.json"
	pairOpenNowName = "pair-open-now.txt"
)

type filePairStore struct{ dir string }

var pairStoreRemove = os.Remove // the tests: an ask that cannot be removed

func platPairStore() pairStore { return filePairStore{Home} }

func (s filePairStore) file(name string) string {
	if name == pairNowVal {
		return filepath.Join(s.dir, pairOpenNowName)
	}
	return filepath.Join(s.dir, pairOpenDueName)
}
func (s filePairStore) get(name string) string { return readText(s.file(name)) }
func (s filePairStore) set(name, v string) error {
	return saveFile(s.file(name), v)
}
func (s filePairStore) del(name string) error {
	if err := pairStoreRemove(s.file(name)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
