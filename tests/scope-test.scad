include <scope-lib.scad>

module outer() {
    module demo_box() { sphere(1); }
    demo_box();
}

demo_box();
echo(library_value);