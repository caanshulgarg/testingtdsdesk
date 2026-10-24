package main

// 2.4.6: the install's first-start ask in the install's own record (pairopen.go): HKLM\SOFTWARE\FinCom\Bridge for the
// service, HKCU for an install just for one user

import (
	"errors"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

type regPairStore struct{ root registry.Key }

var pairStoreKey = regKey // the tests: a key of their own

func platPairStore() pairStore {
	if perUserInstall() {
		return regPairStore{registry.CURRENT_USER}
	}
	return regPairStore{registry.LOCAL_MACHINE}
}

func (s regPairStore) get(name string) string {
	k, err := registry.OpenKey(s.root, pairStoreKey, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return ""
	}
	defer k.Close()
	v, _, _ := k.GetStringValue(name)
	return v
}

func (s regPairStore) set(name, v string) error {
	k, _, err := registry.CreateKey(s.root, pairStoreKey, registry.SET_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return err
	}
	defer k.Close()
	return k.SetStringValue(name, v)
}

func (s regPairStore) del(name string) error {
	k, err := registry.OpenKey(s.root, pairStoreKey, registry.SET_VALUE|registry.WOW64_64KEY)
	if errors.Is(err, windows.ERROR_FILE_NOT_FOUND) {
		return nil
	}
	if err != nil {
		return err
	}
	defer k.Close()
	if err := k.DeleteValue(name); err != nil && !errors.Is(err, windows.ERROR_FILE_NOT_FOUND) {
		return err
	}
	return nil
}
