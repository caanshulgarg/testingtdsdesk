package main

// 2.4.7 (the owner's "yes" of 24-Oct-2026: close the pairing gap of the 2.4.6 security review). A typed 6-digit code is
// checked with SPAKE2 (the shape of RFC 9382) over the 2048-bit MODP group of RFC 3526 (group 14), so nothing the bridge
// answers is an offline test for the code: until 2.4.6 /ping gave pairProof = HMAC(code, nonce || id || port), and one
// such proof let anyone who got it find the code among 10^6 in a second.
//
// The page (src/js/24-tally-bridge.js, the same steps) and the bridge share w = H(code, context) mod q, the context being
// the bridge's id, port and the window's random salt. The page sends X = g^x * M^w; the bridge answers Y = g^y * N^w and
// confirmB = HMAC(k, "bridge"), where k = SHA-256 of the transcript (context, X, Y, Z, w) and Z = (X / M^w)^y; the page
// computes Z = (Y / N^w)^x, checks confirmB (so the bridge knows the code) and sends confirmA = HMAC(k, "page"), which the
// bridge checks before it hands over its key. Each run tests exactly one guess, the one inside X, and every run counts
// against the window's five tries. M and N are hashed into the group (nobody knows their logarithms); every element
// received is checked to be in the subgroup of order q.

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"
)

const spakeGroup14 = "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD" +
	"EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED" +
	"EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F" +
	"83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B" +
	"E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510" +
	"15728E5A8AACAA68FFFFFFFFFFFFFFFF"

var (
	spakeP, spakeQ, spakeG, spakeM, spakeN *big.Int
	spakeOne                               = big.NewInt(1)
)

func init() {
	spakeP, _ = new(big.Int).SetString(spakeGroup14, 16)
	spakeQ = new(big.Int).Rsh(new(big.Int).Sub(spakeP, spakeOne), 1)
	spakeG = big.NewInt(2)
	spakeM = spakeHashToGroup("FinCom pair v2 M")
	spakeN = spakeHashToGroup("FinCom pair v2 N")
}

// 288 bytes (2304 bits) of SHA-256 in counter mode over the label
func spakeExpand(label string) *big.Int {
	var b []byte
	for i := 0; i < 9; i++ {
		h := sha256.Sum256([]byte(fmt.Sprintf("%s|%d", label, i)))
		b = append(b, h[:]...)
	}
	return new(big.Int).SetBytes(b)
}

// an element of the subgroup of order q (a square mod the safe prime p) whose logarithm nobody knows
func spakeHashToGroup(label string) *big.Int {
	v := new(big.Int).Mod(spakeExpand(label), spakeP)
	return v.Exp(v, big.NewInt(2), spakeP)
}

// w: the code and the context (bridge id, port, the window's salt) hashed to Z_q
func spakeW(code, ctx string) *big.Int {
	return new(big.Int).Mod(spakeExpand("FinCom pair v2 w|"+code+"|"+ctx), spakeQ)
}

func spakeHex(v *big.Int) string { return fmt.Sprintf("%0512x", v) }

// an element received: 512 hex digits, 1 < v < p-1, v^q = 1 (in the subgroup of order q)
func spakeElement(s string) (*big.Int, error) {
	if len(s) != 512 || strings.ToLower(s) != s {
		return nil, errors.New("not an element")
	}
	if _, err := hex.DecodeString(s); err != nil {
		return nil, errors.New("not an element")
	}
	v, _ := new(big.Int).SetString(s, 16)
	if v.Cmp(spakeOne) <= 0 || v.Cmp(new(big.Int).Sub(spakeP, spakeOne)) >= 0 || new(big.Int).Exp(v, spakeQ, spakeP).Cmp(spakeOne) != 0 {
		return nil, errors.New("not in the group")
	}
	return v, nil
}

// 32 random bytes as an exponent (128-bit security with short exponents in a safe-prime group)
func spakeScalar() *big.Int {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	v := new(big.Int).SetBytes(b)
	if v.Sign() == 0 {
		v.SetInt64(1)
	}
	return v
}

func spakeTranscript(ctx, X, Y string, Z, w *big.Int) []byte {
	h := sha256.New()
	for _, part := range []string{"FinCom pair v2", ctx, X, Y, spakeHex(Z), spakeHex(w)} {
		var n [8]byte
		binary.BigEndian.PutUint64(n[:], uint64(len(part)))
		h.Write(n[:])
		h.Write([]byte(part))
	}
	return h.Sum(nil)
}

func spakeMAC(k []byte, who string) string {
	m := hmac.New(sha256.New, k)
	m.Write([]byte(who))
	return hex.EncodeToString(m.Sum(nil))
}

// (u / E^w) for E = M or N: u * E^(q-w)
func spakeUnmask(u, e, w *big.Int) *big.Int {
	inv := new(big.Int).Exp(e, new(big.Int).Sub(spakeQ, w), spakeP)
	return inv.Mul(inv, u).Mod(inv, spakeP)
}

// the bridge's step: X from the page; Y, confirmB to answer and confirmA to expect. y nil: a random one (tests: fixed)
func spakeServerStep(Xs string, w *big.Int, ctx string, y *big.Int) (Y, confirmB, confirmA string, err error) {
	X, err := spakeElement(Xs)
	if err != nil {
		return "", "", "", err
	}
	if y == nil {
		y = spakeScalar()
	}
	Yv := new(big.Int).Exp(spakeG, y, spakeP)
	Yv.Mul(Yv, new(big.Int).Exp(spakeN, w, spakeP)).Mod(Yv, spakeP)
	Z := new(big.Int).Exp(spakeUnmask(X, spakeM, w), y, spakeP)
	if Z.Cmp(spakeOne) == 0 {
		return "", "", "", errors.New("degenerate")
	}
	Y = spakeHex(Yv)
	k := spakeTranscript(ctx, Xs, Y, Z, w)
	return Y, spakeMAC(k, "bridge"), spakeMAC(k, "page"), nil
}

// the page's steps (the tests', and the same as src/js/24-tally-bridge.js): x nil: a random one
func spakeClientStart(code, ctx string, x *big.Int) (*big.Int, string) {
	if x == nil {
		x = spakeScalar()
	}
	w := spakeW(code, ctx)
	X := new(big.Int).Exp(spakeG, x, spakeP)
	X.Mul(X, new(big.Int).Exp(spakeM, w, spakeP)).Mod(X, spakeP)
	return x, spakeHex(X)
}

func spakeClientFinish(x, w *big.Int, ctx, Xs, Ys, confirmB string) (string, bool) {
	Y, err := spakeElement(Ys)
	if err != nil {
		return "", false
	}
	Z := new(big.Int).Exp(spakeUnmask(Y, spakeN, w), x, spakeP)
	if Z.Cmp(spakeOne) == 0 {
		return "", false
	}
	k := spakeTranscript(ctx, Xs, Ys, Z, w)
	if !hmac.Equal([]byte(spakeMAC(k, "bridge")), []byte(strings.ToLower(confirmB))) {
		return "", false
	}
	return spakeMAC(k, "page"), true
}
