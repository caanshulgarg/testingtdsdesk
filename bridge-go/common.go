package main

import "errors"

var errNoCodeSign = errors.New("Windows' code signature check is not available here")
